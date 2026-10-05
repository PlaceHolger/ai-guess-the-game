// Audit the pool: entries without screenshots, orphan files, byte-identical
// duplicate shots, shared CDN shots, suspicious metadata. Read-only, except --fix. Usage:
//   npm run audit                       # full report (exit 1 on findings, except exotics)
//   npm run audit -- --year 1990        # single year folder focus
//   npm run audit -- --strict           # exotic candidates also fail the run
//   npm run audit -- --shared-remote    # fast CI gate: shared CDN shots only
//   npm run audit -- --dupes [--fix]    # only the duplicate check; --fix deletes
//                                       # dupes (keeps first) + compacts entries
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DATA_DIR, OUT_DIR, readCatalog } from './igdb-lib.mjs'

function sha(fp) {
  return createHash('sha256').update(readFileSync(fp)).digest('hex')
}

// group files by game. ids with trailing numbers (doom-2, galaga-88) must
// match longest-first, else "doom-2.jpg" looks like alt "-2" of "doom".
function groupByGame(disk, ids) {
  const sorted = [...ids].sort((a, b) => b.length - a.length)
  const groups = new Map()
  for (const rel of disk.keys()) {
    const base = path.basename(rel)
    const m = base.match(/^(.*)\.([^.]+)$/)
    if (!m) continue
    const stem = m[1]
    let id = null
    let slot = 0
    if (sorted.includes(stem)) {
      id = stem
    } else {
      const sm = stem.match(/^(.*)-(\d+)$/)
      if (sm && sorted.includes(sm[1])) {
        id = sm[1]
        slot = Number(sm[2]) - 1
      } else {
        continue
      }
    }
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push({ fp: disk.get(rel), rel, slot })
  }
  for (const files of groups.values()) files.sort((a, b) => a.slot - b.slot)
  return groups
}

async function compactAlts(id, keepRels) {
  // keepRels: remaining "screenshots/<year>/..." paths for slots >= 2
  const { readFile, writeFile } = await import('node:fs/promises')
  // hand source of truth first (generated .ts gets reverted by data:build)
  const { isHandId, setTsvCell } = await import('./igdb-lib.mjs')
  if (await isHandId(id)) {
    await setTsvCell(id, 10, keepRels.join('|'))
    return 'games.tsv'
  }
  const arr = `[${keepRels.map((a) => `'${a}'`).join(', ')}]`
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    let t = await readFile(p, 'utf8')
    const re = new RegExp(`(\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?)"?altScreenshots"?\\s*:\\s*\\[[^\\]]*\\]`)
    if (!re.test(t)) continue
    t = t.replace(re, keepRels.length ? `$1altScreenshots: ${arr}` : '$1')
    // drop a dangling comma before } if the array was the last field
    t = t.replace(/,\s*(\})/g, '$1')
    await writeFile(p, t)
    return f
  }
  return null
}

// commented-out examples (custom.ts) must never parse as entries
const stripComments = (t) => t.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

async function main() {
  const raw = process.argv.slice(2)
  const yearFilter = raw.includes('--year') ? String(raw[raw.indexOf('--year') + 1]) : null
  const strict = raw.includes('--strict')
  const onlyDupes = raw.includes('--dupes')
  let failed = false
  const { readFile } = await import('node:fs/promises')

  // Fast CI-friendly gate: shared CDN shots only, no disk walk, no network.
  if (raw.includes('--shared-remote')) {
    const urlUsers = new Map()
    for (const f of ['games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
      const p = path.join(DATA_DIR, f)
      if (!existsSync(p)) continue
      const t = stripComments(await readFile(p, 'utf8'))
      for (const m of t.matchAll(/\{[^{}]*\}/g)) {
        const b = m[0]
        const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
        if (!id || (yearFilter && !b.includes(yearFilter))) continue
        for (const um of b.matchAll(/https:\/\/images\.igdb\.com[^'"]+/g)) {
          if (!urlUsers.has(um[0])) urlUsers.set(um[0], new Set())
          urlUsers.get(um[0]).add(id)
        }
      }
    }
    const shared = [...urlUsers].filter(([, ids]) => ids.size > 1)
    console.log(`shared remote shots: ${shared.length}`)
    for (const [u, ids] of shared.slice(0, 30)) console.log(`  ${u.slice(-22)} <- ${[...ids].join(' <-> ')}`)
    if (shared.length) process.exitCode = 1
    return
  }

  const catalog = await readCatalog()
  const byId = new Map()
  for (const g of catalog) {
    if (yearFilter && String(g.year) !== yearFilter) continue
    byId.set(g.id, g)
  }

  // files on disk
  const disk = new Map() // relpath -> full
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(jpg|jpeg|png|webp)$/i.test(e.name)) {
        disk.set(path.relative(OUT_DIR, p).replace(/\\/g, '/'), p)
      }
    }
  }
  const walkRoot = yearFilter ? path.join(OUT_DIR, yearFilter) : OUT_DIR
  if (existsSync(walkRoot)) walk(walkRoot)

  // entries -> expected paths (need screenshot field: re-read raw blocks)
  // entries -> expected shot paths. A level counts as missing only when NONE
  // of its shots exist: deleting one bad screenshot promotes the next
  // alternate automatically (PixelCanvas fallback chain).
  const expected = new Map() // relpath -> id
  const shotsOf = new Map() // id -> relpath[]
  const addShot = (id, shot) => {
    if (!shot) return
    const rel = shot.replace(/^\//, '').replace(/^screenshots\//, '')
    expected.set(rel, id)
    if (!shotsOf.has(id)) shotsOf.set(id, [])
    shotsOf.get(id).push(rel)
  }
  for (const f of ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = stripComments(await readFile(p, 'utf8'))
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id || (yearFilter && !b.includes(String(yearFilter)))) continue
      if (byId.size && !byId.has(id)) continue
      addShot(id, b.match(/screenshot:\s*'([^']+)'/)?.[1] ?? b.match(/"screenshot"\s*:\s*"([^"]+)"/)?.[1])
      const altInner = b.match(/"?altScreenshots"?\s*:\s*\[([^\]]*)\]/)?.[1] ?? ''
      for (const am of altInner.matchAll(/['"]([^'"]+)['"]/g)) addShot(id, am[1])
    }
  }

  const missingIds = [...shotsOf.entries()].filter(([, rels]) => rels.length && !rels.some((r) => disk.has(r)))
  const missing = missingIds.map(([id, rels]) => [rels[0], id])
  const orphans = [...disk.keys()].filter((d) => !expected.has(d))

  if (!onlyDupes) {
  console.log(`entries: ${expected.size} | files: ${disk.size}`)
  console.log(`\n-- entries WITHOUT screenshot (${missing.length}) --`)
  for (const [rel, id] of missing.slice(0, 50)) console.log(`  ${rel}  (${id})`)
  if (missing.length > 50) console.log(`  ... +${missing.length - 50} more`)
  console.log(`\n-- files WITHOUT entry / orphans (${orphans.length}) --`)
  for (const o of orphans.slice(0, 30)) console.log(`  ${o}`)
  if (orphans.length > 30) console.log(`  ... +${orphans.length - 30} more`)
  }
  if (!onlyDupes && (missing.length || orphans.length)) failed = true

  // byte-identical duplicates within one game's files (same upload twice)
  const fix = raw.includes('--fix')
  const allIds = new Set([...byId.keys(), ...catalog.map((g) => g.id)])
  const groups = groupByGame(disk, allIds)
  let dupeFiles = 0
  const yearOf = (id) => (byId.get(id)?.year ?? catalog.find((g) => g.id === id)?.year)
  for (const [id, files] of [...groups.entries()].sort()) {
    if (files.length < 2) continue
    const seen = new Map() // hash -> first file
    const dups = []
    for (const f of files) {
      let h
      try { h = sha(f.fp) } catch { continue }
      if (seen.has(h)) dups.push(f)
      else seen.set(h, f)
    }
    if (!dups.length) continue
    dupeFiles += dups.length
    console.log(`\ndupe: ${id}: ${dups.map((d) => path.basename(d.fp)).join(', ')} identical`)
    if (fix) {
      const { rm } = await import('node:fs/promises')
      const gone = new Set(dups.map((d) => d.fp))
      for (const d of dups) await rm(d.fp)
      // compact the entry's altScreenshots to surviving files (slots >= 2)
      const y = yearOf(id)
      const keep = files
        .filter((f) => !gone.has(f.fp) && f.slot > 0)
        .map((f) => `screenshots/${y}/${path.basename(f.fp)}`)
      if (y) {
        const where = await compactAlts(id, keep)
        console.log(`  deleted ${dups.length}, entry ${where ? 'updated' : 'not found?'}`)
      } else {
        console.log(`  deleted ${dups.length} (no year — entry untouched)`)
      }
    }
  }
  if (!dupeFiles) console.log('\n-- duplicates: none --')
  else if (!fix) console.log(`\n${dupeFiles} duplicate files. Re-run with --fix to delete (keeps first) + compact entries.`)
  if (dupeFiles && !fix) failed = true

  // shared CDN shots: two entries serving the identical URL means one level
  // shows the other game's art (unsolvable-as-scored). Zero tolerance.
  const urlUsers = new Map()
  for (const f of ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = stripComments(await readFile(p, 'utf8'))
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id || (yearFilter && !b.includes(yearFilter))) continue
      for (const um of b.matchAll(/https:\/\/images\.igdb\.com[^'"]+/g)) {
        if (!urlUsers.has(um[0])) urlUsers.set(um[0], new Set())
        urlUsers.get(um[0]).add(id)
      }
    }
  }
  const shared = [...urlUsers].filter(([, ids]) => ids.size > 1)
  if (!onlyDupes) {
  console.log(`\n-- shared remote shots (${shared.length}) --`)
  for (const [u, ids] of shared.slice(0, 30)) console.log(`  ${u.slice(-22)} <- ${[...ids].join(' <-> ')}`)
  if (shared.length > 30) console.log(`  ... +${shared.length - 30} more`)
  }
  if (!onlyDupes && shared.length) failed = true

  // suspicious metadata flags (bulk-import heuristics worth a human look)
  const flags = []
  for (const f of ['games.auto.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = stripComments(await readFile(p, 'utf8'))
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = (b.match(/"id"\s*:\s*"([^"]+)"/) || [])[1]
      if (!id) continue
      if (/"publisher"\s*:\s*"Unknown"/.test(b)) flags.push(`${id}: publisher Unknown`)
      if (/"genre"\s*:\s*"Action"/.test(b)) flags.push(`${id}: generic genre Action`)
    }
  }
  if (!onlyDupes) {
  console.log(`\n-- review flags (${flags.length}) --`)
  for (const fl of flags.slice(0, 40)) console.log(`  ${fl}`)
  if (flags.length > 40) console.log(`  ... +${flags.length - 40} more`)
  }

  // exotic/obscure candidates: anachronistic platform-era, unknown publisher,
  // future-dated. Review these when trimming homebrews and unguessables.
  // Commercial lifespan end per platform (generous); null = ongoing/unknown.
  const ERA_END = {
    'Atari 2600': 1992, NES: 1995, SNES: 1999, N64: 2002, GameCube: 2007,
    'Game Boy': 2003, 'Game Boy Color': 2003, 'Game Boy Advance': 2008, DS: 2014,
    Genesis: 1998, 'Game Gear': 1997, 'Master System': 1997, Saturn: 2000,
    Dreamcast: 2001, PS1: 2006, PS2: 2013, PSP: 2014, PS3: 2017, 'Xbox 360': 2016,
    Wii: 2013, 'Wii U': 2017, 'Xbox One': 2020, ColecoVision: 1985,
    Intellivision: 1991, 'Amstrad CPC': 1990, 'Commodore 64': 1994, Amiga: 1996,
    'Atari ST': 1993, 'Apple II': 1993, MSX: 1995, 'ZX Spectrum': 1992,
    'BBC Micro': 1994, DOS: 2000, 'SG-1000': 1987,
  }
  const exotic = []
  for (const f of ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = stripComments(await readFile(p, 'utf8'))
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id || !byId.has(id)) continue
      const year = Number(b.match(/year:\s*(\d+)/)?.[1] ?? b.match(/"year"\s*:\s*(\d+)/)?.[1])
      const pm = b.match(/"?platforms"?\s*:\s*\[([^\]]*)\]/)
      const plats = pm ? [...pm[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : []
      const pub = b.match(/publisher:\s*'([^']+)'/)?.[1] ?? b.match(/"publisher"\s*:\s*"([^"]+)"/)?.[1] ?? ''
      if (year > 2025) exotic.push(`${id}: dated ${year} (future?)`)
      if (/^unknown$/i.test(pub)) exotic.push(`${id}: publisher Unknown`)
      const ends = plats.map((pl) => ERA_END[pl]).filter((e) => e !== undefined)
      if (plats.length && ends.length === plats.length && year > Math.max(...ends) + 5) {
        exotic.push(`${id}: ${year} on dead platform(s) ${plats.join('/')} (homebrew/hack?)`)
      }
    }
  }
  const seenEx = new Set()
  const uniqExotic = exotic.filter((e) => !seenEx.has(e) && (seenEx.add(e), true))
  if (!onlyDupes) {
  console.log(`\n-- exotic candidates (${uniqExotic.length}) --`)
  for (const e of uniqExotic.slice(0, 60)) console.log(`  ${e}`)
  if (uniqExotic.length > 60) console.log(`  ... +${uniqExotic.length - 60} more`)
  }
  console.log('\nRemove bad levels with: npm run remove -- --id <game> [--keep-shot]')
  // CI gate: missing shots, orphans, dupes and shared remotes fail the run.
  // Exotic candidates (future dates etc.) fail only with --strict.
  // (--dupes mode judges duplicates only.)
  if (!onlyDupes && (missing.length || orphans.length || shared.length)) process.exitCode = 1
  if (dupeFiles) process.exitCode = 1
  if (strict && uniqExotic.length) process.exitCode = 1
}

main()

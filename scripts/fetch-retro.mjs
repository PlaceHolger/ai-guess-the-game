// Retro screenshot fetcher: Libretro Thumbnails -> public/screenshots/<year>/<id>.png
// Fills gaps left by the IGDB fetcher, ideal for pre-2005 console classics.
// No API key needed. Usage:
//   npm run fetch:retro -- --id mario-world   # single game
//   npm run fetch:retro -- --all              # every entry missing a screenshot
//   npm run fetch:retro -- --all --dry        # preview matches only
//   npm run fetch:retro -- --system SNES      # limit to one platform
//
// How it works: per system repo it fetches the Named_Snaps file list once
// (cached), matches our titles against No-Intro ROM names (region tags
// stripped, USA/Europe preferred, Beta/Proto/Sample excluded), downloads the
// PNG and rewrites the entry's screenshot path to .png.
//
// Legal note: these are fan-captured screenshots of copyrighted games — same
// posture as IGDB shots (local use, © publishers, review by hand).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DATA_DIR, OUT_DIR, normTitle, readCatalog, sleep } from './igdb-lib.mjs'

// our platform -> libretro-thumbnails repo (only ones confirmed to exist)
const SYSTEMS = {
  NES: 'Nintendo_-_Nintendo_Entertainment_System',
  SNES: 'Nintendo_-_Super_Nintendo_Entertainment_System',
  N64: 'Nintendo_-_Nintendo_64',
  GameCube: 'Nintendo_-_GameCube',
  'Game Boy': 'Nintendo_-_Game_Boy',
  'Game Boy Color': 'Nintendo_-_Game_Boy_Color',
  'Game Boy Advance': 'Nintendo_-_Game_Boy_Advance',
  DS: 'Nintendo_-_Nintendo_DS',
  Genesis: 'Sega_-_Mega_Drive_-_Genesis',
  'Game Gear': 'Sega_-_Game_Gear',
  'Master System': 'Sega_-_Master_System_-_Mark_III',
  Saturn: 'Sega_-_Saturn',
  Dreamcast: 'Sega_-_Dreamcast',
  PS1: 'Sony_-_PlayStation',
  PS2: 'Sony_-_PlayStation_2',
  PSP: 'Sony_-_PlayStation_Portable',
  'Atari 2600': 'Atari_-_2600',
  Intellivision: 'Mattel_-_Intellivision',
  'Amstrad CPC': 'Amstrad_-_CPC',
}

const CACHE = path.join(os.tmpdir(), 'gameguesser-retro-trees.json')
const PREF_REGION = ['usa', 'europe', 'world', 'japan']
const BAD_TAGS = ['beta', 'proto', 'sample', 'rev', 'np', 'virtual console', 'collection', 'arcade', 'enhancement', 'switch online', 'classic mini']

function normFile(s) {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[_]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleVariants(title) {
  const out = new Set([title])
  const noThe = title.replace(/^the\s+/i, '')
  if (noThe !== title) out.add(noThe)
  const m = title.match(/^(.*?),\s*the$/i)
  if (m) out.add(`The ${m[1]}`)
  out.add(title.replace(/&/g, 'and'))
  return [...out].map(normFile)
}

function splitTags(file) {
  const base = file.replace(/\.png$/i, '')
  const tags = [...base.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].toLowerCase())
  const name = base.replace(/\s*\([^)]*\)/g, '').trim()
  return { name: normFile(name), tags }
}

function score(tags) {
  if (tags.some((t) => BAD_TAGS.some((b) => t.includes(b)))) return null
  const regions = tags.filter((t) => PREF_REGION.includes(t))
  if (!regions.length) return 50 // no region tag at all — usable fallback
  return Math.min(...regions.map((r) => PREF_REGION.indexOf(r)))
}

async function loadTrees(refresh) {
  if (!refresh && existsSync(CACHE)) {
    try {
      const cached = JSON.parse(await readFile(CACHE, 'utf8'))
      if (cached._v === 1) return cached
    } catch { /* refetch */ }
  }
  const trees = { _v: 1 }
  for (const [plat, repo] of Object.entries(SYSTEMS)) {
    const r = await fetch(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`, {
      headers: { 'User-Agent': 'gameguesser' },
    })
    if (!r.ok) {
      console.warn(`tree failed for ${repo}: ${r.status} (skipped)`)
      continue
    }
    const j = await r.json()
    trees[plat] = (j.tree ?? []).filter((e) => e.path.startsWith('Named_Snaps/')).map((e) => e.path.slice('Named_Snaps/'.length))
    console.log(`${plat}: ${trees[plat].length} snaps`)
    await sleep(500) // stay far under the 60/hr API budget
  }
  await writeFile(CACHE, JSON.stringify(trees))
  return trees
}

function findSnap(title, files) {
  const variants = titleVariants(title)
  let best = null
  for (const f of files) {
    const { name, tags } = splitTags(f)
    if (!variants.includes(name)) continue
    const s = score(tags)
    if (s === null) continue
    if (!best || s < best.s) best = { f, s }
    if (s === 0 && tags.length === 1) break // perfect USA-only hit
  }
  return best?.f ?? null
}

function entryFile(id) {
  // locate which data file holds this entry (hand first)
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = readFileSyncOrNull(p)
    const idRe = new RegExp(`(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")`)
    if (t && idRe.test(t)) return p
  }
  return null
}

function readFileSyncOrNull(p) {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

async function patchScreenshotPath(file, id, year, fromExt, toExt) {
  let t = await readFile(file, 'utf8')
  // entries store relative paths now; still match legacy absolute ones
  for (const prefix of ['screenshots/', '/screenshots/']) {
    const from = `${prefix}${year}/${id}.${fromExt}`
    if (t.includes(from)) {
      await writeFile(file, t.replace(from, `${prefix}${year}/${id}.${toExt}`))
      return true
    }
  }
  return false
}

async function shotExistsLocally(year, id) {
  return (
    existsSync(path.join(OUT_DIR, String(year), `${id}.jpg`)) ||
    existsSync(path.join(OUT_DIR, String(year), `${id}.png`))
  )
}

async function main() {
  const raw = process.argv.slice(2)
  const onlyId = raw.includes('--id') ? raw[raw.indexOf('--id') + 1] : null
  const all = raw.includes('--all')
  const dry = raw.includes('--dry')
  const refresh = raw.includes('--refresh')
  const sysFilter = raw.includes('--system') ? raw[raw.indexOf('--system') + 1] : null
  if (!onlyId && !all) {
    console.error('Usage: --id <game> | --all [--dry] [--system PLATFORM] [--refresh]')
    process.exit(1)
  }

  const catalog = await readCatalog()
  const trees = await loadTrees(refresh)

  let targets = catalog.filter((g) => g.year && (!onlyId || g.id === onlyId))
  if (sysFilter) {
    const plats = await platformMap()
    targets = targets.filter((g) => (plats[g.id] ?? []).includes(sysFilter))
  }
  console.log(`${targets.length} candidates`)

  const notes = []
  for (const g of targets) {
    if (await shotExistsLocally(g.year, g.id)) continue
    const plats = (await platformMap())[g.id] ?? []
    const usable = plats.filter((p) => SYSTEMS[p] && trees[p]?.length)
    if (!usable.length) continue
    let hit = null
    for (const p of usable) {
      hit = findSnap(g.title ?? g.query ?? g.id, trees[p])
      if (hit) { hit = { repo: SYSTEMS[p], file: hit, plat: p }; break }
    }
    if (!hit) {
      console.log(`no snap: ${g.id} (${usable.join('/')})`)
      continue
    }
    console.log(`match: ${g.id} <- [${hit.plat}] ${hit.file}`)
    if (dry) continue
    const url = `https://raw.githubusercontent.com/libretro-thumbnails/${hit.repo}/master/Named_Snaps/${encodeURIComponent(hit.file).replace(/%2F/g, '/')}`
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    if (buf[0] !== 0x89 || buf[1] !== 0x50) {
      console.warn(`bad download for ${g.id} (not a PNG)`)
      continue
    }
    const dir = path.join(OUT_DIR, String(g.year))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${g.id}.png`), buf)
    const src = entryFile(g.id)
    if (src) await patchScreenshotPath(src, g.id, g.year, 'jpg', 'png')
    notes.push(`- ${g.id}: "${hit.file}" via libretro-thumbnails/${hit.repo}`)
  }
  if (notes.length && !dry) {
    const attr = path.join(OUT_DIR, 'ATTRIBUTION-RETRO.md')
    const prev = existsSync(attr) ? await readFile(attr, 'utf8') : '# Retro screenshot attribution\n\nSnaps via libretro-thumbnails (fan captures). All images © their publishers.\n'
    await writeFile(attr, prev + notes.join('\n') + '\n')
  }
  console.log(dry ? '(dry run — nothing downloaded)' : 'Done. Review the new PNGs by hand.')
}

// platform lookup cache (built once per run from the TS sources)
let _plats = null
async function platformMap() {
  if (_plats) return _plats
  _plats = {}
  for (const f of ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = await readFile(p, 'utf8')
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id) continue
      const pm = b.match(/"?platforms"?\s*:\s*\[([^\]]*)\]/)
      _plats[id] = pm ? [...pm[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : []
    }
  }
  return _plats
}

main()

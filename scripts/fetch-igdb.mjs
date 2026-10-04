// Screenshot fetcher: IGDB -> public/screenshots/<year>/<id>[-2,-3].jpg
// Downloads up to --shots screenshots per entry (default 3): the primary plus
// alternates the reviewer can fall back to (delete a bad one, the game uses
// the next). Alternates are recorded in the entry's altScreenshots field and
// rotate per player (never twice in one round, see src/lib/game.ts).
// Year-aware matching: a candidate must match the title AND (±1 year) unless
// it's an exact title hit. Better to skip than to save the wrong game.
// Usage: npm run fetch:screenshots [-- <id> | --list] [--shots N]

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  DATA_DIR,
  OUT_DIR,
  big,
  getCreds,
  igdb,
  matchBest,
  readCatalog,
  sleep,
  twitchToken,
} from './igdb-lib.mjs'

function altName(id, i, ext) {
  return i === 0 ? `${id}${ext}` : `${id}-${i + 1}${ext}`
}

async function downloadShots(game, needed, existingHashes, ext, clientId, token) {
  // needed: [{slot, dest}] in preference order; returns [{slot, dest, url, name}]
  const found = await igdb(
    'games',
    `search "${game.query.replace(/"/g, '')}"; fields id,name,first_release_date,screenshots; limit 40;`,
    clientId, token,
  )
  const cands = found.filter((x) => x.screenshots?.length)
  if (!cands.length) {
    console.warn(`no screenshots for ${game.id} ("${game.query}")`)
    return null
  }
  const best = matchBest(cands, game)
  if (!best) {
    console.warn(`no confident match for ${game.id} ("${game.query}", ${game.year})`)
    return null
  }
  if (!best.yearOk && best.cy !== null) {
    console.warn(`note: ${game.id} year ${game.year} vs IGDB "${best.c.name}" (${best.cy}) — taking it anyway (exact title)`)
  }
  const shots = await igdb(
    'screenshots',
    `fields url,width,height; where id = (${best.c.screenshots.slice(0, 8).join(',')}); limit 8;`,
    clientId, token,
  )
  shots.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  const saved = []
  const seenUrls = new Set()
  for (const slot of needed) {
    let shot = null
    // skip candidates byte-identical to shots we already have (IGDB hosts
    // the same upload under several records; backfills would re-save it)
    while (!shot) {
      const cand = shots.find((s) => !seenUrls.has(s.url))
      if (!cand) break
      seenUrls.add(cand.url)
      const url = big(cand.url)
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
      const hash = createHash('sha256').update(buf).digest('hex')
      if (existingHashes.has(hash)) continue
      existingHashes.add(hash)
      await writeFile(slot.dest, buf)
      shot = { cand, url, hash }
    }
    if (!shot) break
    saved.push({ ...slot, url: shot.url, name: best.c.name })
  }
  return saved
}

function entryFile(id) {
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = readFileSyncCache(p)
    const idRe = new RegExp(`(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")`)
    if (t && idRe.test(t)) return p
  }
  return null
}

function readFileSyncCache(p) {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

async function setAlts(file, id, alts) {
  // alts: ["/screenshots/<year>/<id>-2.jpg", ...] — replace or insert altScreenshots
  let t = await readFile(file, 'utf8')
  const arr = `[${alts.map((a) => `'${a}'`).join(', ')}]`
  const re = new RegExp(`(\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?)"?altScreenshots"?\\s*:\\s*\\[[^\\]]*\\]`)
  if (re.test(t)) {
    t = t.replace(re, `$1altScreenshots: ${arr}`)
  } else {
    const re2 = new RegExp(`(\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?screenshot\\s*:\\s*['"][^'"]+['"])`)
    if (!re2.test(t)) return false
    t = t.replace(re2, `$1, altScreenshots: ${arr}`)
  }
  await writeFile(file, t)
  return true
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const shotsIdx = rawArgs.indexOf('--shots')
  const maxShots = shotsIdx >= 0 ? Math.max(1, Number(rawArgs[shotsIdx + 1]) || 1) : 3
  const rest = shotsIdx >= 0 ? rawArgs.filter((_, i) => i !== shotsIdx && i !== shotsIdx + 1) : rawArgs
  const only = rest.find((a) => !a.startsWith('--'))
  const list = rest.includes('--list')

  const games = await readCatalog()
  if (list) {
    for (const g of games) console.log(`${g.year} ${g.id} <- "${g.query ?? '(custom, no IGDB query)'}"`)
    console.log(`Total: ${games.length} games`)
    return
  }
  const queue = only ? games.filter((g) => g.id === only) : games
  console.log(`Found ${queue.length} games (up to ${maxShots} shots each).`)

  const { clientId, secret } = await getCreds()
  await mkdir(OUT_DIR, { recursive: true })
  const token = await twitchToken(clientId, secret)
  const attribution = ['# Screenshot attribution', '', 'Downloaded via the IGDB API for guessing-game use.', 'All images © their respective publishers/developers.', '']

  for (const g of queue) {
    if (!g.year) {
      console.warn(`skip ${g.id} (no year)`)
      continue
    }
    const dir = path.join(OUT_DIR, String(g.year))
    await mkdir(dir, { recursive: true })
    const ext = (g.shot?.match(/\.(jpg|jpeg|png|webp)$/i) || [])[0] ?? '.jpg'
    const needed = []
    for (let i = 0; i < maxShots; i++) {
      const dest = path.join(dir, altName(g.id, i, ext))
      if (!existsSync(dest)) needed.push({ slot: i, dest, rel: `/screenshots/${g.year}/${altName(g.id, i, ext)}` })
    }
    // move legacy flat downloads into place
    const legacy = path.join(OUT_DIR, `${g.id}.jpg`)
    if (existsSync(legacy) && needed.some((n) => n.slot === 0)) {
      await rename(legacy, path.join(dir, altName(g.id, 0, ext)))
      console.log(`moved ${g.id} into ${g.year}/`)
      needed.shift()
    }
    if (!needed.length) {
      attribution.push(`- ${g.id}: existing files kept`)
      continue
    }
    if (!g.query) {
      console.log(`skip ${g.id} (no igdbQuery — add its screenshot by hand)`)
      continue
    }
    try {
      // hashes of shots already on disk: never save the same bytes twice
      const existingHashes = new Set()
      for (let i = 0; i < maxShots; i++) {
        const fp = path.join(dir, altName(g.id, i, ext))
        if (existsSync(fp)) {
          try {
            existingHashes.add(createHash('sha256').update(readFileSync(fp)).digest('hex'))
          } catch { /* unreadable — will be overwritten */ }
        }
      }
      const saved = await downloadShots(g, needed, existingHashes, ext, clientId, token)
      if (saved?.length) {
        const first = saved[0]
        attribution.push(`- ${g.id}: "${first.name}" via IGDB (${first.url}${saved.length > 1 ? ` +${saved.length - 1} alts` : ''})`)
        console.log(`saved ${g.id} <- ${first.name}${saved.length > 1 ? ` (+${saved.length - 1} alts)` : ''}`)
        // record alternates on the entry
        const altRels = []
        for (let i = 1; i < maxShots; i++) {
          const p = path.join(dir, altName(g.id, i, ext))
          if (existsSync(p)) altRels.push(`/screenshots/${g.year}/${altName(g.id, i, ext)}`)
        }
        if (altRels.length) {
          const src = entryFile(g.id)
          if (src) await setAlts(src, g.id, altRels)
        }
      }
      await sleep(300) // be nice to the API
    } catch (e) {
      console.warn(`failed ${g.id}: ${e.message}`)
    }
  }
  await writeFile(path.join(OUT_DIR, 'ATTRIBUTION.md'), attribution.join('\n'))
  console.log('\nDone. Review public/screenshots by hand, then run the game with npm run dev.')
}

main()

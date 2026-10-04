// Backfill Metacritic scores via RAWG (the only licensed source for MC numbers).
// Needs RAWG_API_KEY in .env (free key from rawg.io/apidocs).
// Usage: npm run metacritic [--dry] [--limit N]
// Matches by exact title + release year (same rule as screenshots); entries
// without a score stay blank. Throttled for the free quota.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, loadDotEnv, matchBest, normTitle, sleep } from './igdb-lib.mjs'

async function main() {
  const dry = process.argv.includes('--dry')
  const limIdx = process.argv.indexOf('--limit')
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity

  const env = { ...process.env, ...(await loadDotEnv()) }
  const key = env.RAWG_API_KEY
  if (!key) {
    console.error('Missing RAWG_API_KEY. Add it to .env (free key from rawg.io/apidocs).')
    process.exit(1)
  }

  // entries lacking a metacritic field
  const targets = []
  const files = ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']
  for (const f of files) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = await readFile(p, 'utf8')
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id) continue
      if (/metacritic/i.test(b)) continue
      const title = b.match(/title:\s*'([^']+)'/)?.[1] ?? b.match(/"title"\s*:\s*"([^"]+)"/)?.[1] ?? ''
      const year = Number(b.match(/year:\s*(\d+)/)?.[1] ?? b.match(/"year"\s*:\s*(\d+)/)?.[1]) || undefined
      if (title) targets.push({ file: p, id, title, year })
    }
  }
  // TSV source rows without metacritic (no metacritic column yet — add when first score lands)
  console.log(`${targets.length} entries without metacritic${Number.isFinite(limit) ? ` (processing ${Math.min(limit, targets.length)})` : ''}`)

  let filled = 0
  let n = 0
  for (const e of targets) {
    if (n++ >= limit) break
    let hits = []
    try {
      const r = await fetch(
        `https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(e.title)}&page_size=8`,
      )
      if (r.status === 401 || r.status === 403) {
        console.error('RAWG key rejected (401/403) — check RAWG_API_KEY.')
        process.exit(1)
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      hits = (j.results ?? []).map((g) => ({
        name: g.name,
        first_release_date: g.released ? Date.parse(g.released + 'T00:00:00Z') / 1000 : null,
        metacritic: g.metacritic ?? null,
        slug: g.slug,
      }))
    } catch (err) {
      console.warn(`query failed ${e.id}: ${err.message}`)
      continue
    }
    const best = matchBest(hits, { query: e.title, title: e.title, year: e.year })
    if (!best || best.c.metacritic == null) {
      console.log(`no score: ${e.id} ("${e.title}")`)
      continue
    }
    console.log(`${dry ? 'would fill' : 'fill'} ${e.id} <- "${best.c.name}": metacritic ${best.c.metacritic}`)
    if (dry) continue
    // hand entries live in games.tsv (generated hand.ts would be overwritten)
    const tsvPath = path.join(DATA_DIR, 'games.tsv')
    if (existsSync(tsvPath)) {
      const lines = (await readFile(tsvPath, 'utf8')).split('\n')
      const idx = lines.findIndex((l) => l.split('\t')[0] === e.id)
      if (idx >= 0) {
        const cells = lines[idx].split('\t')
        while (cells.length < 12) cells.push('')
        cells[11] = String(best.c.metacritic)
        lines[idx] = cells.join('\t')
        await writeFile(tsvPath, lines.join('\n'))
        filled++
        await sleep(1200)
        continue
      }
    }
    let t = await readFile(e.file, 'utf8')
    const re = new RegExp(`(\\{[^{}]*?(?:id:\\s*'${e.id}'|"id"\\s*:\\s*"${e.id}")[^{}]*?\\})`)
    const m = t.match(re)
    if (!m) {
      console.warn(`  block gone for ${e.id}`)
      continue
    }
    const json = m[0].includes('"screenshot"')
    const field = json ? `"metacritic": ${best.c.metacritic}` : `metacritic: ${best.c.metacritic}`
    await writeFile(e.file, t.replace(m[0], m[0].replace(/\}$/, `, ${field}}`)))
    filled++
    await sleep(1200) // stay well under free-quota rate limits
  }
  console.log(dry ? '(dry run — nothing written)' : `filled ${filled} scores`)
}

main()

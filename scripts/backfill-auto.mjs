// One-time enrich pass over bulk-imported entries: popularity flag, franchise,
// engine (all from IGDB), plus publisher normalization (Sierra variants).
// Usage: npm run backfill [--dry] [--limit N]
// Rule: popular = rating_count >= 25 (hand list is always popular by curation).
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, getCreds, igdb, sleep, twitchToken } from './igdb-lib.mjs'

const AUTO_FILE = path.join(DATA_DIR, 'games.auto.ts')
const VOTES_POPULAR = 25

const PUBLISHER_NORM = [
  [/^Sierra (Studios|On-Line|Online Shanghai|Northwest|Entertainment)$/, 'Sierra'],
]

const FRANCHISE_NORM = [
  [/^Mario Bros\.?$/, 'Mario'],
  [/^Super Mario$/, 'Mario'],
  [/^The Legend of Zelda$/, 'Zelda'],
]

function canonFranchise(n) {
  let out = n.replace(/^The\s+/i, '')
  for (const [re, to] of FRANCHISE_NORM) out = out.replace(re, to)
  return out
}

async function main() {
  const dry = process.argv.includes('--dry')
  const limIdx = process.argv.indexOf('--limit')
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity
  const t = await readFile(AUTO_FILE, 'utf8')
  const ids = [...t.matchAll(/"igdbId"\s*:\s*(\d+)/g)].map((m) => Number(m[1]))
  console.log(`auto entries with igdbId: ${ids.length}`)

  const { clientId, secret } = await getCreds()
  const token = await twitchToken(clientId, secret)
  const info = new Map()
  const scoped = ids.slice(0, limit)
  for (let i = 0; i < scoped.length; i += 200) {
    const batch = scoped.slice(i, i + 200)
    const rows = await igdb(
      'games',
      `fields id,rating_count,franchises.name,game_engines.name; where id = (${batch.join(',')}); limit 500;`,
      clientId, token,
    )
    for (const r of rows) info.set(r.id, r)
    await sleep(300)
  }

  let text = t
  let pop = 0
  let niche = 0
  let fr = 0
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const b = m[0]
    const id = (b.match(/"igdbId"\s*:\s*(\d+)/) || [])[1]
    if (!id || !info.has(Number(id))) continue
    const g = info.get(Number(id))
    const votes = g.rating_count ?? 0
    const popular = votes >= VOTES_POPULAR
    const frName = (g.franchises ?? [])[0]?.name
    const engName = (g.game_engines ?? [])[0]?.name
    let nb = b
    // publisher normalization (quoted JSON only — auto file)
    const pub = (nb.match(/"publisher"\s*:\s*"([^"]+)"/) || [])[1]
    if (pub) {
      for (const [re, to] of PUBLISHER_NORM) {
        if (re.test(pub) && pub !== to) {
          nb = nb.replace(
            new RegExp(`"publisher"\\s*:\\s*"${pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
            `"publisher": "${to}"`,
          )
          break
        }
      }
    }
    // append new fields before closing brace (skip if already present)
    const add = []
    if (!/"popular"\s*:/.test(nb)) add.push(`"popular": ${popular}`)
    if (frName && !/"franchise"\s*:/.test(nb)) {
      add.push(`"franchise": "${canonFranchise(frName).replace(/"/g, '')}"`)
      fr++
    }
    if (engName && !/"engine"\s*:/.test(nb)) add.push(`"engine": "${engName.replace(/"/g, '')}"`)
    if (add.length) nb = nb.replace(/\}$/, `, ${add.join(', ')}}`)
    if (nb !== b) {
      text = text.split(b).join(nb)
      popular ? pop++ : niche++
    }
  }
  console.log(`popular: ${pop}, niche: ${niche}, franchises set: ${fr}${dry ? ' (dry — not written)' : ''}`)
  if (!dry) await writeFile(AUTO_FILE, text)
}

main()

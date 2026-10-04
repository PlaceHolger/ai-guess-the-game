// Resolve canonical IGDB CDN URLs (no downloading) and record them as
// remote/remoteAlts so the game hotlinks instead of re-hosting.
// Usage: npm run backfill-remote [--dry] [--limit N]
// Auto entries resolve by igdbId (1 batched call per 500); hand entries by
// title+year search with the usual exact/year matcher.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, big, getCreds, igdb, matchBest, sleep, twitchToken } from './igdb-lib.mjs'

async function main() {
  const dry = process.argv.includes('--dry')
  const limIdx = process.argv.indexOf('--limit')
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity

  // collect entries lacking remote (id -> {file, title, year, igdbId})
  const targets = new Map()
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = await readFile(p, 'utf8')
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id || targets.has(id) || /"remote"\s*:|remote:\s*['"]/.test(b)) continue
      // skip // comment lines (e.g. the custom-entry example)
      const lineStart = t.slice(0, m.index).split('\n').pop() ?? ''
      if (lineStart.trimStart().startsWith('//')) continue
      // value may use the other quote style when it contains an apostrophe
      const str = (n) => b.match(new RegExp(`"?${n}"?\\s*:\\s*(['"])(.*?)\\1`))?.[2] ?? ''
      const ig = Number(b.match(/igdbId:\s*(\d+)/)?.[1] ?? b.match(/"igdbId"\s*:\s*(\d+)/)?.[1]) || null
      const title = str('title')
      const year = Number(str('year')) || undefined
      if (title) targets.set(id, { file: p, id, title, year, igdbId: ig })
    }
  }
  const list = [...targets.values()].slice(0, limit)
  console.log(`${targets.size} entries without remote${Number.isFinite(limit) ? ` (processing ${list.length})` : ''}`)
  if (!list.length) return

  const { clientId, secret } = await getCreds()
  const token = await twitchToken(clientId, secret)
  const shotsOf = async (gid) => {
    const det = await igdb('games', `fields screenshots.url,screenshots.width; where id = ${gid}; limit 1;`, clientId, token)
    return det[0]?.screenshots ?? []
  }

  // Hand entries live in games.tsv (games.hand.ts is regenerated on every
  // build), so their remotes go straight into the TSV row.
  const patchTsv = async (id, shots) => {
    const tsv = path.join(DATA_DIR, 'games.tsv')
    const lines = (await readFile(tsv, 'utf8')).split('\n')
    const idx = lines.findIndex((l) => l.split('\t')[0] === id)
    if (idx < 0) {
      console.warn(`  TSV row gone for ${id}`)
      return
    }
    const cells = lines[idx].split('\t')
    while (cells.length < 14) cells.push('')
    cells[12] = shots[0]
    cells[13] = shots.slice(1).join('|')
    lines[idx] = cells.join('\t')
    await writeFile(tsv, lines.join('\n'))
  }

  let filled = 0
  for (const e of list) {
    try {
      let gid = e.igdbId
      if (!gid) {
        const found = await igdb('games', `search "${e.title.replace(/"/g, '')}"; fields id,name,first_release_date; limit 10;`, clientId, token)
        const best = matchBest(found, { query: e.title, title: e.title, year: e.year })
        if (!best) {
          console.log(`no match: ${e.id}`)
          continue
        }
        gid = best.c.id
        await sleep(300)
      }
      const shots = [...(await shotsOf(gid))]
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
        .slice(0, 3)
        .map((s) => big(s.url))
      if (!shots.length) {
        console.log(`no shots: ${e.id}`)
        continue
      }
      console.log(`${dry ? 'would fill' : 'fill'} ${e.id}: ${shots.length} remote shot(s)`)
      if (dry) continue
      if (e.file.endsWith('games.hand.ts')) {
        await patchTsv(e.id, shots)
        filled++
        await sleep(300)
        continue
      }
      let t = await readFile(e.file, 'utf8')
      const m = t.match(new RegExp(`\\{[^{}]*?(?:id:\\s*'${e.id}'|"id"\\s*:\\s*"${e.id}")[^{}]*?\\}`))
      if (!m) {
        console.warn(`  block gone for ${e.id}`)
        continue
      }
      const json = m[0].includes('"screenshot"')
      const q = (s) => (json ? `"${s}"` : `'${s}'`)
      const k = (n) => (json ? `"${n}"` : n)
      const ins = `${k('remote')}: ${q(shots[0])}` + (shots[1] ? `, ${k('remoteAlts')}: [${shots.slice(1).map(q).join(', ')}]` : '')
      await writeFile(e.file, t.replace(m[0], m[0].replace(/\}$/, `, ${ins}}`)))
      filled++
      await sleep(300)
    } catch (err) {
      console.warn(`failed ${e.id}: ${err.message}`)
    }
  }
  console.log(dry ? '(dry run — nothing written)' : `filled ${filled} remotes`)
}

main()

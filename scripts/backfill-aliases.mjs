// Backfill regional/alternative titles (IGDB alternative_names) into aliases.
// Usage: npm run backfill-aliases [--dry] [--limit N]
// Keeps romanizations/translations/abbreviations/acronyms; skips stylized
// dupes, executables and non-Latin scripts. Never touches existing aliases.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, getCreds, igdb, normTitle, sleep, twitchToken } from './igdb-lib.mjs'

const SKIP_COMMENT = /stylized|executable/i
// Only Latin-script aliases can ever match: fuzzy normalization strips every
// other script, so CJK/Cyrillic/Arabic entries are unguessable dead weight.
const MATCHABLE = /^[a-zA-Z0-9\s'’\-:.,!&()$]+$/
const MAX_ALIASES = 8

async function main() {
  const dry = process.argv.includes('--dry')
  const limIdx = process.argv.indexOf('--limit')
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity

  // igdbId per entry id
  const ids = new Map()
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = await readFile(p, 'utf8')
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      const ig = Number(b.match(/igdbId:\s*(\d+)/)?.[1] ?? b.match(/"igdbId"\s*:\s*(\d+)/)?.[1]) || null
      if (id && ig && !ids.has(id)) ids.set(id, ig)
    }
  }
  console.log(`entries with igdbId: ${ids.size}`)

  const { clientId, secret } = await getCreds()
  const token = await twitchToken(clientId, secret)
  const all = [...ids.entries()]
  const scoped = Number.isFinite(limit) ? all.slice(0, limit) : all
  const info = new Map()
  for (let i = 0; i < scoped.length; i += 200) {
    const batch = scoped.slice(i, i + 200)
    const rows = await igdb(
      'games',
      `fields id,alternative_names.name,alternative_names.comment; where id = (${batch.map(([, g]) => g).join(',')}); limit 500;`,
      clientId, token,
    )
    for (const r of rows) info.set(r.id, r.alternative_names ?? [])
    await sleep(300)
  }

  let touched = 0
  for (const [id, ig] of scoped) {
    const alts = (info.get(ig) ?? [])
      .filter((a) => a.name && !SKIP_COMMENT.test(a.comment ?? ''))
      .map((a) => a.name.trim())
      .filter((n) => n && MATCHABLE.test(n) && n.length <= 60)
    if (!alts.length) continue
    // patch whichever file holds the entry (tsv row, ts/json block)
    if (await addAliases(id, alts, dry)) touched++
  }
  console.log(dry ? `(dry run)` : `updated ${touched} entries — run npm run data:build`)
}

async function addAliases(id, alts, dry) {
  const tsv = path.join(DATA_DIR, 'games.tsv')
  if (existsSync(tsv)) {
    const lines = (await readFile(tsv, 'utf8')).split('\n')
    const idx = lines.findIndex((l) => l.split('\t')[0] === id)
    if (idx >= 0) {
      const cells = lines[idx].split('\t')
      while (cells.length < 11) cells.push('')
      const have = new Set([normTitle(cells[1]), ...cells[7].split('|').map(normTitle)])
      const fresh = alts.map((a) => a.toLowerCase()).filter((a) => a && !have.has(normTitle(a)) && !have.has(a))
      const merged = [...cells[7].split('|').filter(Boolean), ...fresh].slice(0, MAX_ALIASES)
      if (merged.length === cells[7].split('|').filter(Boolean).length) return false
      console.log(`${dry ? 'would add' : 'add'} ${id}: ${fresh.join(' | ')}`)
      if (dry) return true
      cells[7] = merged.join('|')
      lines[idx] = cells.join('\t')
      await writeFile(tsv, lines.join('\n'))
      return true
    }
  }
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = await readFile(p, 'utf8')
    const m = t.match(new RegExp(`\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?\\}`))
    if (!m) continue
    const b = m[0]
    const json = b.includes('"aliases"')
    const inner = (b.match(/"?aliases"?\s*:\s*\[([^\]]*)\]/) || [])[1] ?? ''
    const have = new Set([...inner.matchAll(/['"]([^'"]+)['"]/g)].map((x) => normTitle(x[1])))
    const fresh = alts.map((a) => a.toLowerCase()).filter((a) => a && !have.has(normTitle(a)))
    if (!fresh.length) return false
    const cur = [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
    const merged = [...cur, ...fresh].slice(0, MAX_ALIASES)
    const arr = json ? `[${merged.map((s) => `"${s.replace(/"/g, '')}"`).join(', ')}]` : `[${merged.map((s) => (s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`)).join(', ')}]`
    const nb = b.replace(/"?aliases"?\s*:\s*\[[^\]]*\]/, json ? `"aliases": ${arr}` : `aliases: ${arr}`)
    console.log(`${dry ? 'would add' : 'add'} ${id}: ${fresh.join(' | ')}`)
    if (dry) return true
    await writeFile(p, t.replace(b, nb))
    return true
  }
  return false
}

main()

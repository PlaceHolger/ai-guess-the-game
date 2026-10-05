// Data hygiene pass: mechanical, verifiable, dry-run-first.
//  - drops aliases that normalize to the entry's own title (exact title
//    already matches; the dupes only inflate the bundle and fuzzy scans)
//  - dedupes platform lists preserving order (fixes B5's double counting)
// Usage: node scripts/fix-data.mjs [--dry] [--apply]
// Default is --dry (report only).
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './igdb-lib.mjs'

// Same normalization the guess matcher uses (src/lib/fuzzy.ts): aliases
// equal to the title under THESE rules never change a match.
const norm = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const apply = process.argv.includes('--apply')
let selfAlias = 0
let platFix = 0

function cleanBlock(id, title, plats, aliases) {
  const nt = norm(title)
  const seenAlias = new Set()
  const keptAliases = aliases.filter((a) => {
    if (!a || norm(a) === nt || seenAlias.has(a)) {
      if (a && !seenAlias.has(a)) selfAlias++
      return false
    }
    seenAlias.add(a)
    return true
  })
  const seen = new Set()
  const keptPlats = plats.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
  if (keptPlats.length !== plats.length) platFix++
  return { keptAliases, keptPlats }
}

// TSV (hand source of truth): platforms col 6, aliases col 7
{
  const p = path.join(DATA_DIR, 'games.tsv')
  const lines = readFileSync(p, 'utf8').split('\n')
  let changed = false
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cells = lines[i].split('\t')
    const plats = cells[6].split('|').map((s) => s.trim()).filter(Boolean)
    const aliases = cells[7] ? cells[7].split('|').map((s) => s.trim()).filter(Boolean) : []
    const { keptAliases, keptPlats } = cleanBlock(cells[0], cells[1], plats, aliases)
    const np = keptPlats.join('|')
    const na = keptAliases.join('|')
    if (np !== cells[6] || na !== (cells[7] ?? '')) {
      cells[6] = np
      cells[7] = na
      lines[i] = cells.join('\t')
      changed = true
    }
  }
  if (changed && apply) writeFileSync(p, lines.join('\n'))
  console.log(`tsv: ${changed ? 'would update' : 'clean'}`)
}

// auto.ts arrays (hand.ts regenerates from TSV via data:build)
{
  const p = path.join(DATA_DIR, 'games.auto.ts')
  let t = readFileSync(p, 'utf8')
  let n = 0
  t = t.replace(/\{[^{}]*\}/g, (b) => {
    const id = (b.match(/"id"\s*:\s*"([^"]+)"/) || [])[1]
    if (!id) return b
    const title = (b.match(/"title"\s*:\s*"([^"]+)"/) || [])[1] ?? ''
    const pm = b.match(/"platforms"\s*:\s*\[([^\]]*)\]/)
    const am = b.match(/"aliases"\s*:\s*\[([^\]]*)\]/)
    if (!pm || !am) return b
    const plats = [...pm[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
    const aliases = [...am[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
    const { keptAliases, keptPlats } = cleanBlock(id, title, plats, aliases)
    let nb = b
    if (keptPlats.length !== plats.length) {
      nb = nb.replace(/"platforms"\s*:\s*\[[^\]]*\]/, `"platforms":[${keptPlats.map((s) => JSON.stringify(s)).join(', ')}]`)
    }
    if (keptAliases.length !== aliases.length) {
      nb = nb.replace(/"aliases"\s*:\s*\[[^\]]*\]/, `"aliases":[${keptAliases.map((s) => JSON.stringify(s)).join(', ')}]`)
    }
    if (nb !== b) n++
    return nb
  })
  if (apply) writeFileSync(p, t)
  console.log(`auto.ts: ${n} entries ${apply ? 'cleaned' : 'would clean'}`)
}

console.log(`self-title aliases dropped: ${selfAlias}, platform lists deduped: ${platFix}`)
if (!apply) console.log('(dry run — nothing written; re-run with --apply)')

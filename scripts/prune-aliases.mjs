// Prune stub acronym aliases: normalized length < 3 ("lf", "ds", ", ") are
// noise now that autocomplete surfaces exact titles after 2 keystrokes, and
// they widen every "fits several games" prompt. Real alternate titles
// ("siedler", "gta 5", "botw", "ff7") are all >= 3 and untouched, as are the
// fuzzy-matcher's own rules (tested in src/lib/fuzzy.test.ts).
// Usage: node scripts/prune-aliases.mjs [--dry] [--apply]
// Default is --dry (report only). --apply rewrites games.tsv (aliases column)
// and games.auto.ts (aliases arrays); games.hand.ts regenerates via data:build.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, normTitle } from './igdb-lib.mjs'

const apply = process.argv.includes('--apply')
let dropped = 0
const examples = new Set()

const keep = (a) => normTitle(a).length >= 3 || (dropped++, examples.size < 30 && examples.add(a), false)

// TSV aliases column (index 7); preserve BOM/line-endings byte-wise
{
  const p = path.join(DATA_DIR, 'games.tsv')
  const raw = readFileSync(p, 'utf8')
  const lines = raw.split('\n')
  let changed = false
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t')
    if (cells.length < 8 || !cells[7]) continue
    const kept = cells[7].split('|').map((s) => s.trim()).filter((s) => s && keep(s))
    const next = kept.join('|')
    if (next !== cells[7]) { cells[7] = next; lines[i] = cells.join('\t'); changed = true }
  }
  if (changed && apply) writeFileSync(p, lines.join('\n'))
  console.log(`tsv: ${changed ? 'would update' : 'clean'}`)
}

// auto.ts aliases arrays
{
  const p = path.join(DATA_DIR, 'games.auto.ts')
  let t = readFileSync(p, 'utf8')
  let n = 0
  t = t.replace(/"aliases"\s*:\s*\[([^\]]*)\]/g, (m, inner) => {
    const all = [...inner.matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1])
    const kept = all.filter((s) => s && keep(s))
    if (kept.length === all.length) return m
    n++
    return `"aliases":[${kept.map((s) => JSON.stringify(s)).join(', ')}]`
  })
  if (apply) writeFileSync(p, t)
  console.log(`auto.ts: ${n} arrays ${apply ? 'pruned' : 'would prune'}`)
}

console.log(`dropped stub aliases: ${dropped}${examples.size ? ' e.g. ' + [...examples].slice(0, 30).join(', ') : ''}`)
if (!apply) console.log('(dry run — nothing written; re-run with --apply)')

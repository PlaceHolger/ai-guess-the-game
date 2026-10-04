// Build src/data/games.hand.ts from src/data/games.tsv (source of truth).
// Runs automatically before dev/build (predev/prebuild). Fails loudly on bad
// rows so spreadsheet edits can't silently corrupt the pool.
// TSV columns:
//   id  title  year  genre  publisher  developer  platforms  aliases  igdbQuery  screenshot  altScreenshots  metacritic  remote  remoteAlts
// Lists use | separators: platforms "SNES|Wii", aliases "smw|mario world".
// Empty igdbQuery / altScreenshots allowed. No tabs or newlines inside fields.
// Spreadsheet tips: open as UTF-8, tab-delimited; keep the year column as text;
// save back as UTF-8 TSV (Excel needs the BOM, which this file keeps).
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const TSV = path.join(ROOT, 'src', 'data', 'games.tsv')
const OUT = path.join(ROOT, 'src', 'data', 'games.hand.ts')
const COLS = ['id', 'title', 'year', 'genre', 'publisher', 'developer', 'platforms', 'aliases', 'igdbQuery', 'screenshot', 'altScreenshots', 'metacritic', 'remote', 'remoteAlts']

// quote a TS string literal, preferring single quotes like the rest of the codebase
function q(s) {
  if (!s.includes("'")) return `'${s}'`
  if (!s.includes('"')) return `"${s}"`
  return `'${s.replace(/'/g, "\\'")}'`
}

export function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  let header = (lines.shift() ?? '').split('\t')
  // metacritic / remote columns are optional in existing sheets (added on first backfill)
  for (const legacy of [COLS.slice(0, 11), COLS.slice(0, 12)]) {
    if (header.join('\t') === legacy.join('\t')) header = [...header, ...COLS.slice(header.length)]
  }
  if (header.join('\t') !== COLS.join('\t')) {
    throw new Error(`bad TSV header:\n  got:      ${header.join('|')}\n  expected: ${COLS.join('|')}`)
  }
  const rows = []
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const cells = line.split('\t')
    while (cells.length < COLS.length - 2) cells.push('') // pre-metacritic sheet
    while (cells.length < COLS.length) cells.push('') // pre-remote sheet
    if (cells.length !== COLS.length) {
      throw new Error(`line ${i + 2}: ${cells.length} cells, expected ${COLS.length}`)
    }
    const r = Object.fromEntries(COLS.map((c, k) => [c, cells[k].trim()]))
    if (!r.id) throw new Error(`line ${i + 2}: missing id`)
    if (!/^[a-z0-9-]+$/.test(r.id)) throw new Error(`line ${i + 2} (${r.id}): id must be lowercase letters/digits/dashes`)
    if (!r.title) throw new Error(`line ${i + 2} (${r.id}): missing title`)
    const year = Number(r.year)
    if (!Number.isInteger(year) || year < 1970 || year > 2026) throw new Error(`line ${i + 2} (${r.id}): bad year "${r.year}"`)
    if (!r.screenshot) throw new Error(`line ${i + 2} (${r.id}): missing screenshot`)
    r.year = year
    r.platforms = r.platforms.split('|').map((s) => s.trim()).filter(Boolean)
    if (!r.platforms.length) throw new Error(`line ${i + 2} (${r.id}): need at least one platform`)
    r.aliases = r.aliases.split('|').map((s) => s.trim()).filter(Boolean)
    r.altScreenshots = r.altScreenshots.split('|').map((s) => s.trim()).filter(Boolean)
    r.remoteAlts = (r.remoteAlts ?? '').split('|').map((s) => s.trim()).filter(Boolean)
    if (r.metacritic && !/^\d{1,3}$/.test(r.metacritic)) throw new Error(`line ${i + 2} (${r.id}): bad metacritic "${r.metacritic}"`)
    r.line = i + 2
    rows.push(r)
  })
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.id)) throw new Error(`line ${r.line}: duplicate id "${r.id}"`)
    seen.add(r.id)
  }
  return rows
}

export function emitTs(rows) {
  const body = rows
    .map((r) => {
      const parts = [
        `id: ${q(r.id)}`, `title: ${q(r.title)}`, `year: ${r.year}`, `genre: ${q(r.genre || 'Unknown')}`,
        `publisher: ${q(r.publisher || 'Unknown')}`, `developer: ${q(r.developer || 'Unknown')}`,
        `platforms: [${r.platforms.map(q).join(', ')}]`, `aliases: [${r.aliases.map(q).join(', ')}]`,
      ]
      if (r.igdbQuery) parts.push(`igdbQuery: ${q(r.igdbQuery)}`)
      parts.push(`screenshot: ${q(r.screenshot)}`)
      if (r.altScreenshots.length) parts.push(`altScreenshots: [${r.altScreenshots.map(q).join(', ')}]`)
      if (r.metacritic) parts.push(`metacritic: ${r.metacritic}`)
      if (r.remote) parts.push(`remote: ${q(r.remote)}`)
      if (r.remoteAlts.length) parts.push(`remoteAlts: [${r.remoteAlts.map(q).join(', ')}]`)
      return `  { ${parts.join(', ')} },`
    })
    .join('\n')
  return (
    `import type { GameEntry } from './games'\n\n` +
    `// GENERATED from games.tsv — do not edit (run npm run data:build).\n` +
    `export const HAND_GAMES: GameEntry[] = [\n${body}\n]\n`
  )
}

async function main() {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const dest = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : OUT
  const inIdx = args.indexOf('--in')
  const src = inIdx >= 0 ? path.resolve(args[inIdx + 1]) : TSV
  if (!existsSync(src)) {
    console.log(`no ${path.basename(src)} yet — skipping data build`)
    return
  }
  const rows = parseTsv(await readFile(src, 'utf8'))
  await writeFile(dest, emitTs(rows))
  console.log(`games.tsv: ${rows.length} rows -> ${path.relative(ROOT, dest)}`)
}

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/build-data.mjs')
if (isMain) main()

// Add a custom game by hand: copies your screenshot into place and appends
// an entry to src/data/games.custom.ts (merged into the game automatically).
// Usage:
//   npm run add-custom -- --id larry-2 --title "Leisure Suit Larry 2" --year 1988 \
//     --genre Adventure --publisher "Sierra On-Line" --developer "Sierra On-Line" \
//     --platforms DOS --aliases "larry 2,ls l2" --image ./shot.png
//
// Only --id, --title, --year and --image are required. Year/platform/genre feed
// the same filters and year folders as every other level.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, OUT_DIR, normTitle, readCatalog } from './igdb-lib.mjs'

const CUSTOM_FILE = path.join(DATA_DIR, 'games.custom.ts')
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function args() {
  const a = { genre: 'Unknown', publisher: 'Unknown', developer: 'Unknown', platforms: 'PC', aliases: '' }
  const raw = process.argv.slice(2)
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]
    if (t === '--id') a.id = raw[++i]
    else if (t === '--title') a.title = raw[++i]
    else if (t === '--year') a.year = Number(raw[++i])
    else if (t === '--genre') a.genre = raw[++i]
    else if (t === '--publisher') a.publisher = raw[++i]
    else if (t === '--developer') a.developer = raw[++i]
    else if (t === '--platforms') a.platforms = raw[++i]
    else if (t === '--aliases') a.aliases = raw[++i]
    else if (t === '--image') a.image = raw[++i]
    else if (t === '--igdb-query') a.igdbQuery = raw[++i]
    else if (t === '--force') a.force = true
    else { console.error(`unknown arg: ${t}`); process.exit(1) }
  }
  return a
}

// quote a TS string literal, preferring single quotes like the hand list
function q(s) {
  if (!s.includes("'")) return `'${s}'`
  if (!s.includes('"')) return `"${s}"`
  return `'${s.replace(/'/g, "\\'")}'`
}

async function main() {
  const a = args()
  if (!a.id || !a.title || !a.year || !a.image) {
    console.error('Required: --id <slug> --title "Name" --year YYYY --image <file>')
    process.exit(1)
  }
  if (!/^[a-z0-9-]+$/.test(a.id)) {
    console.error('id must be lowercase letters, digits and dashes (used in URLs and filenames)')
    process.exit(1)
  }
  if (!(a.year >= 1970 && a.year <= 2026)) {
    console.error('year must be between 1970 and 2026')
    process.exit(1)
  }
  if (!existsSync(a.image)) {
    console.error(`image not found: ${a.image}`)
    process.exit(1)
  }
  const ext = path.extname(a.image).toLowerCase()
  if (!IMG_EXTS.has(ext)) {
    console.error(`unsupported image type ${ext} (use jpg, png or webp)`)
    process.exit(1)
  }

  const catalog = await readCatalog()
  const ids = new Set(catalog.map((g) => g.id))
  if (ids.has(a.id) && !a.force) {
    console.error(`id "${a.id}" already exists (use --force to re-add anyway)`)
    process.exit(1)
  }
  const key = `${normTitle(a.title)}@${a.year}`
  const clash = catalog.find((g) => g.title && g.year && `${normTitle(g.title)}@${g.year}` === key && g.id !== a.id)
  if (clash) console.warn(`note: similar entry exists (${clash.id} "${clash.title}")`)

  const dir = path.join(OUT_DIR, String(a.year))
  await mkdir(dir, { recursive: true })
  const dest = path.join(dir, `${a.id}${ext}`)
  if (existsSync(dest) && !a.force) {
    console.error(`screenshot exists: ${dest} (use --force to overwrite)`)
    process.exit(1)
  }
  await copyFile(a.image, dest)
  console.log(`copied screenshot -> ${dest}`)

  const platforms = a.platforms.split(',').map((s) => s.trim()).filter(Boolean)
  const aliases = a.aliases.split(',').map((s) => s.trim()).filter(Boolean)
  const entry =
    `  { id: ${q(a.id)}, title: ${q(a.title)}, year: ${a.year}, genre: ${q(a.genre)}, ` +
    `publisher: ${q(a.publisher)}, developer: ${q(a.developer)}, platforms: [${platforms.map(q).join(', ')}], ` +
    `aliases: [${aliases.map(q).join(', ')}], ` +
    (a.igdbQuery ? `igdbQuery: ${q(a.igdbQuery)}, ` : '') +
    `screenshot: 'screenshots/${a.year}/${a.id}${ext}' },`

  let text = await readFile(CUSTOM_FILE, 'utf8')
  const trimmed = text.trimEnd()
  if (!trimmed.endsWith(']')) throw new Error(`${CUSTOM_FILE} has unexpected format`)
  const inner = trimmed.slice(0, -1).trimEnd()
  const sep = inner.endsWith('[') ? '\n' : ',\n'
  await writeFile(CUSTOM_FILE, `${inner}${sep}${entry}\n]\n`)
  console.log(`appended "${a.id}" to src/data/games.custom.ts — it is playable immediately (reload the dev page)`)
}

main()

// One-time converter: src/data/games.ts HAND_GAMES -> src/data/games.tsv.
// Run AFTER any in-flight fetcher finished (it reads current altScreenshots).
// Afterwards: npm run data:build, swap games.ts to import HAND_GAMES, verify.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const cell = (v) => (v ?? '').replace(/\t|\r|\n/g, ' ').trim()

async function main() {
  const ts = await readFile(path.join(ROOT, 'src', 'data', 'games.ts'), 'utf8')
  const lines = [
    'id\ttitle\tyear\tgenre\tpublisher\tdeveloper\tplatforms\taliases\tigdbQuery\tscreenshot\taltScreenshots\tmetacritic',
  ]
  let n = 0
  for (const m of ts.matchAll(/\{[^{}]*\}/g)) {
    const b = m[0]
    const get = (re) => {
      const mm = b.match(re)
      return mm ? mm[1] ?? mm[2] : ''
    }
    const id = get(/id:\s*'([^']+)'/) || get(/id:\s*"([^"]+)"/)
    if (!id) continue
    const str = (name) => get(new RegExp(`${name}:\\s*'([^']+)'`)) || get(new RegExp(`${name}:\\s*"([^"]+)"`))
    const list = (name) => {
      const inner = (b.match(new RegExp(`${name}:\\s*\\[([^\\]]*)\\]`)) || [])[1] ?? ''
      return [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).join('|')
    }
    const year = (b.match(/year:\s*(\d+)/) || [])[1] ?? ''
    const mc = (b.match(/metacritic:\s*(\d+)/) || [])[1] ?? ''
    lines.push(
      [id, str('title'), year, str('genre'), str('publisher'), str('developer'),
        list('platforms'), list('aliases'), str('igdbQuery'), str('screenshot'), list('altScreenshots'), mc,
      ].map(cell).join('\t'),
    )
    n++
  }
  await writeFile(path.join(ROOT, 'src', 'data', 'games.tsv'), '\uFEFF' + lines.join('\n') + '\n')
  console.log(`wrote ${n} rows to src/data/games.tsv`)
}

main()

// Remove levels entirely.
//   npm run remove -- --id <game> [--keep-shot]   # single entry (+ its file)
//   npm run remove -- --missing --auto-only [--dry]        # all shot-less AUTO entries
//   npm run remove -- --missing --include-hand [--dry]     # ...plus hand/custom ones
// --dry only lists. Bulk mode refuses to run without one of the scope flags
// so a typo can't wipe your hand-curated list.
import { readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, OUT_DIR } from './igdb-lib.mjs'

const FILES = ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']

function blocksOf(t) {
  return [...t.matchAll(/\{[^{}]*\}/g)].map((m) => m[0])
}

function blockId(b) {
  return b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
}

function blockShots(b) {
  // all shot files for an entry (primary + alternates); entry counts as
  // present when ANY exists (deleting one bad shot promotes the next)
  const out = []
  const s = b.match(/screenshot:\s*'([^']+)'/)?.[1] ?? b.match(/"screenshot"\s*:\s*"([^"]+)"/)?.[1]
  if (s) out.push(path.join(OUT_DIR, s.replace(/^\//, '').replace(/^screenshots\//, '')))
  const altInner = b.match(/"?altScreenshots"?\s*:\s*\[([^\]]*)\]/)?.[1] ?? ''
  for (const m of altInner.matchAll(/['"]([^'"]+)['"]/g)) {
    out.push(path.join(OUT_DIR, m[1].replace(/^\//, '').replace(/^screenshots\//, '')))
  }
  return out
}

function removeId(t, id) {
  const re = new RegExp(`\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?\\}`, 'g')
  if (!re.test(t)) return null
  return t
    .replace(re, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\s*,/g, '[')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/,\s*(\n\s*\])/g, '$1')
}

async function main() {
  const raw = process.argv.slice(2)
  const dry = raw.includes('--dry')

  if (raw.includes('--missing')) {
    const autoOnly = raw.includes('--auto-only')
    const includeHand = raw.includes('--include-hand')
    if (!autoOnly && !includeHand) {
      console.error('Refusing bulk remove without scope: add --auto-only or --include-hand (plus --dry to preview).')
      process.exit(1)
    }
    const files = autoOnly ? ['games.auto.ts'] : FILES
    let total = 0
    for (const f of files) {
      const p = path.join(DATA_DIR, f)
      if (!existsSync(p)) continue
      let t = await readFile(p, 'utf8')
      const gone = []
      for (const b of blocksOf(t)) {
        const id = blockId(b)
        if (!id) continue
        if (blockShots(b).some((fp) => existsSync(fp))) continue
        gone.push(id)
      }
      if (!gone.length) continue
      console.log(`${f}: ${gone.length} without screenshot${dry ? ' (would remove)' : ''}`)
      for (const id of gone.slice(0, 20)) console.log(`  - ${id}`)
      if (gone.length > 20) console.log(`  ... +${gone.length - 20} more`)
      if (!dry) {
        for (const id of gone) t = removeId(t, id) ?? t
        await writeFile(p, t)
      }
      total += gone.length
    }
    console.log(dry ? `\n${total} would be removed. Re-run without --dry to apply.` : `\nRemoved ${total} entries.`)
    return
  }

  if (!raw.includes('--id')) {
    console.error('Usage: npm run remove -- --id <game-id> [--keep-shot]  OR  --missing --auto-only|--include-hand [--dry]')
    process.exit(1)
  }
  const id = raw[raw.indexOf('--id') + 1]
  const keepShot = raw.includes('--keep-shot')

  for (const f of FILES) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = await readFile(p, 'utf8')
    const next = removeId(t, id)
    if (next === null) continue
    if (!dry) await writeFile(p, next)
    console.log(`${dry ? 'would remove' : 'removed'} entry "${id}" from ${f}`)
  }

  if (!keepShot && !dry) {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      for (const y of readdirSync(OUT_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
        for (const fp of [
          path.join(OUT_DIR, y, `${id}.${ext}`),
          ...[2, 3, 4, 5].map((n) => path.join(OUT_DIR, y, `${id}-${n}.${ext}`)),
        ]) {
          if (existsSync(fp)) {
            await rm(fp)
            console.log(`deleted ${fp}`)
          }
        }
      }
    }
  }
  console.log('Done. Rebuild/refresh the page to see the pool without it.')
}

main()

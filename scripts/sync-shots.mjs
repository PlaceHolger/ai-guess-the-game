// Reconcile entries with files on disk after manual review.
// You delete bad shots by hand in public/screenshots/<year>/, then:
//   npm run sync-shots [--dry]
// Per entry: drop listed shots whose files are gone; promote the first
// existing alternate to primary when the primary was deleted; report levels
// with no shots left (re-fetch or remove them). Remote CDN URLs untouched.
// TSV rows, TS blocks and JSON blocks are all handled in place.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, OUT_DIR } from './igdb-lib.mjs'

const toDisk = (s) => path.join(OUT_DIR, s.replace(/^\//, '').replace(/^screenshots\//, ''))

function splitShots(b) {
  const one = (re) => (b.match(re) || [])[1]
  const primary = one(/screenshot:\s*'([^']+)'/) ?? one(/"screenshot"\s*:\s*"([^"]+)"/) ?? null
  const altInner = (b.match(/"?altScreenshots"?\s*:\s*\[([^\]]*)\]/) || [])[1] ?? ''
  const alts = [...altInner.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
  return { primary, alts }
}

function renderBlock(b, primary, alts) {
  const json = b.includes('"screenshot"')
  const q = (s) => (json ? `"${s}"` : s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`)
  let nb = b.replace(/"?screenshot"?\s*:\s*['"][^'"]+['"]/, (json ? '"screenshot"' : 'screenshot') + `: ${q(primary)}`)
  const arr = `[${alts.map(q).join(', ')}]`
  if (/"?altScreenshots"?\s*:/.test(nb)) {
    nb = nb.replace(/"?altScreenshots"?\s*:\s*\[[^\]]*\]/, `${json ? '"altScreenshots"' : 'altScreenshots'}: ${arr}`)
  } else if (alts.length) {
    nb = nb.replace(/\}$/, `, ${json ? '"altScreenshots"' : 'altScreenshots'}: ${arr}}`)
  }
  // drop the field entirely when no alternates remain
  if (!alts.length) {
    nb = nb.replace(/,?\s*"?altScreenshots"?\s*:\s*\[[^\]]*\]/, '')
  }
  return nb
}

async function main() {
  const dry = process.argv.includes('--dry')
  let synced = 0
  const missing = []
  const patchBlockFile = async (file, id, primary, alts) => {
    const t = await readFile(file, 'utf8')
    const m = t.match(new RegExp(`\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?\\}`))
    if (!m) return false
    const nb = renderBlock(m[0], primary, alts)
    if (nb === m[0]) return false
    await writeFile(file, t.replace(m[0], nb))
    return true
  }

  // TSV hand rows (strip full-line comments first — the example block)
  const tsv = path.join(DATA_DIR, 'games.tsv')
  if (existsSync(tsv)) {
    const lines = (await readFile(tsv, 'utf8')).split('\n')
    let touched = false
    lines.forEach((line, i) => {
      if (!i || !line.trim()) return
      const cells = line.split('\t')
      while (cells.length < 12) cells.push('')
      const shots = [cells[9], ...cells[10].split('|').filter(Boolean)]
      const kept = shots.filter((s) => existsSync(toDisk(s)))
      const cur = [cells[9], ...cells[10].split('|').filter(Boolean)].join('|')
      if (kept.length === shots.length && kept[0] === cells[9]) return
      if (!kept.length) {
        missing.push(`${cells[0]} (was ${shots[0]})`)
        return
      }
      cells[9] = kept[0]
      cells[10] = kept.slice(1).join('|')
      lines[i] = cells.join('\t')
      touched = true
      synced++
      console.log(`${dry ? 'would sync' : 'synced'} ${cells[0]} -> ${kept[0]}${kept.length > 1 ? ` (+${kept.length - 1} alts)` : ''}`)
    })
    if (touched && !dry) await writeFile(tsv, lines.join('\n'))
  }

  // TS/JSON blocks (skip full-line // comment examples)
  for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    let t = await readFile(p, 'utf8')
    let touched = false
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      if (m.index === undefined) continue
      const lineStart = t.slice(0, m.index).split('\n').pop() ?? ''
      if (lineStart.trimStart().startsWith('//')) continue
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id) continue
      const { primary, alts } = splitShots(b)
      if (!primary) continue
      const shots = [primary, ...alts]
      const kept = shots.filter((s) => existsSync(toDisk(s)))
      if (kept.length === shots.length && kept[0] === primary) continue
      if (!kept.length) {
        missing.push(`${id} (was ${primary})`)
        continue
      }
      const nb = renderBlock(b, kept[0], kept.slice(1))
      if (nb === b) continue
      t = t.replace(b, nb)
      touched = true
      synced++
      console.log(`${dry ? 'would sync' : 'synced'} ${id} -> ${kept[0]}${kept.length > 1 ? ` (+${kept.length - 1} alts)` : ''}`)
    }
    if (touched && !dry) await writeFile(p, t)
  }
  console.log(dry ? '(dry run)' : `synced ${synced} entries`)
  if (missing.length) {
    console.log(`\nno shots left (${missing.length}) — re-fetch or remove:`)
    console.log(missing.slice(0, 30).join('\n'))
  }
}

main()

// Record on-disk alternates (<id>-2.*, <id>-3.*) into entries' altScreenshots.
// Fixes entries whose shots were downloaded but never recorded (e.g. older
// fetcher versions). Safe to re-run: only references existing files.
// Usage: npm run record-alts [--dry]
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, OUT_DIR, readCatalog } from './igdb-lib.mjs'

function altFiles(year, id) {
  const out = []
  for (const n of [2, 3, 4, 5]) {
    for (const ext of ['jpg', 'png', 'webp']) {
      const rel = `${year}/${id}-${n}.${ext}`
      if (existsSync(path.join(OUT_DIR, rel))) {
        out.push(`/screenshots/${rel}`)
        break
      }
    }
  }
  return out
}

async function patchTs(file, id, alts) {
  let t = await readFile(file, 'utf8')
  const arr = `[${alts.map((a) => `'${a}'`).join(', ')}]`
  const arrJ = `[${alts.map((a) => `"${a}"`).join(', ')}]`
  const hasRe = new RegExp(`(\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?)"?altScreenshots"?\\s*:\\s*\\[[^\\]]*\\]`)
  if (hasRe.test(t)) {
    const next = t.replace(hasRe, `$1altScreenshots: ${arr}`)
    if (next !== t) { await writeFile(file, next); return true }
    return false
  }
  const idRe = new RegExp(`\\{[^{}]*?(?:id:\\s*'${id}'|"id"\\s*:\\s*"${id}")[^{}]*?\\}`)
  const m = t.match(idRe)
  if (!m) return false
  const block = m[0]
  const json = block.includes('"screenshot"')
  const ins = json
    ? block.replace(/("screenshot"\s*:\s*"[^"]+")/, `$1, "altScreenshots": ${arrJ}`)
    : block.replace(/(screenshot\s*:\s*'[^']+')/, `$1, altScreenshots: ${arr}`)
  if (ins === block) return false
  await writeFile(file, t.replace(block, ins))
  return true
}

async function patchTsv(file, id, alts) {
  const lines = (await readFile(file, 'utf8')).split('\n')
  const idx = lines.findIndex((l) => l.split('\t')[0] === id)
  if (idx < 0) return false
  const cells = lines[idx].split('\t')
  while (cells.length < 11) cells.push('')
  const next = cells[10] === alts.join('|') ? null : alts.join('|')
  if (next === null) return false
  cells[10] = next
  lines[idx] = cells.join('\t')
  await writeFile(file, lines.join('\n'))
  return true
}

async function main() {
  const dry = process.argv.includes('--dry')
  const catalog = await readCatalog()
  const tsvIds = new Set()
  const tsvPath = path.join(DATA_DIR, 'games.tsv')
  if (existsSync(tsvPath)) {
    for (const l of (await readFile(tsvPath, 'utf8')).split('\n')) {
      const id = l.split('\t')[0]
      if (id && id !== 'id') tsvIds.add(id)
    }
  }
  let updated = 0
  let already = 0
  for (const g of catalog) {
    if (!g.year) continue
    const alts = altFiles(String(g.year), g.id)
    if (!alts.length) continue
    // current record?
    const cur = g.alts ?? []
    if (cur.length === alts.length && cur.every((a, i) => a === alts[i])) {
      already++
      continue
    }
    console.log(`${dry ? 'would record' : 'record'} ${g.id}: ${alts.join(', ')}`)
    if (dry) continue
    let ok = false
    if (tsvIds.has(g.id)) ok = await patchTsv(tsvPath, g.id, alts)
    else {
      const idRe = new RegExp(`(?:id:\\s*'${g.id}'|"id"\\s*:\\s*"${g.id}")`)
      for (const f of ['games.hand.ts', 'games.ts', 'games.auto.ts', 'games.custom.ts']) {
        const p = path.join(DATA_DIR, f)
        if (!existsSync(p)) continue
        const t = await readFile(p, 'utf8')
        if (idRe.test(t)) {
          ok = await patchTs(p, g.id, alts)
          break
        }
      }
    }
    if (ok) updated++
    else console.warn(`  entry not found for ${g.id}`)
  }
  console.log(`\n${already} already recorded, ${dry ? 'would update' : 'updated'}: ${updated}`)
  if (updated && !dry) console.log('Run npm run data:build to regenerate (or rely on predev/prebuild).')
}

main()

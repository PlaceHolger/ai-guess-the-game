// Fetch per-title units-sold figures for the end-of-round info row.
// Sources (both keyless, CC0/by-attr): Wikidata P2664 (~1,250 games, one
// SPARQL query) + Wikipedia "List of best-selling video games" (~55 titles
// at >=25M via the MediaWiki API). Writes src/data/sales.tsv:
//   id<TAB>unitsSold<TAB>source   (wikidata | wikipedia)
// Join is deliberately strict (normalized title + year; yearless figures only
// join an unambiguous title) — better to skip than to mis-attribute.
// The script's primary output is its match rate; expect ~7-16% of the pool.
// Usage: npm run fetch:sales [--dry]
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, normTitle, readCatalog } from './igdb-lib.mjs'

const OUT = path.join(DATA_DIR, 'sales.tsv')

async function wikidata() {
  // label + copies + publication date for joining
  const q = `SELECT ?game ?gameLabel ?copies ?date WHERE { ?game wdt:P2664 ?copies . ?game wdt:P31/wdt:P279* wd:Q7889 . OPTIONAL { ?game wdt:P577 ?date . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?copies)`
  const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`, {
    headers: { 'User-Agent': 'GuessTheGame/1.0 (sales backfill)', Accept: 'application/sparql-results+json' },
  })
  if (!res.ok) throw new Error(`wikidata SPARQL: ${res.status}`)
  const json = await res.json()
  const rows = []
  for (const b of json.results.bindings) {
    const year = b.date?.value ? Number(b.date.value.slice(0, 4)) : null
    rows.push({
      title: b.gameLabel.value,
      copies: Math.round(Number(b.copies.value)),
      year: Number.isInteger(year) ? year : null,
      source: 'wikidata',
    })
  }
  return rows
}

function stripHtml(s) {
  return s
    .replace(/<sup[^>]*>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

async function wikipedia() {
  // parsed HTML of the list; first cell of each wikitable row = title
  const url =
    'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_best-selling_video_games&prop=text&format=json&formatversion=2'
  const res = await fetch(url, { headers: { 'User-Agent': 'GuessTheGame/1.0 (sales backfill)' } })
  if (!res.ok) throw new Error(`mediawiki API: ${res.status}`)
  const json = await res.json()
  const html = json?.parse?.text ?? ''
  const rows = []
  for (const tm of html.matchAll(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g)) {
    for (const rm of tm[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => stripHtml(m[1]))
      if (cells.length < 3) continue
      // rank column present on most rows ("1", "2", …) but missing on some —
      // locate columns by it. Sales are millions (see the header).
      const ranked = /^\d+\s*$/.test(cells[0])
      const title = ranked ? cells[1] : cells[0]
      const millions = Number((ranked ? cells[2] : cells[1]).replace(/,/g, ''))
      const yearRaw = ranked ? cells[5] : cells[4]
      const year = /^\d{4}$/.test((yearRaw ?? '').trim()) ? Number(yearRaw.trim()) : null
      if (!title || /^(title|rank)$/i.test(title) || !Number.isFinite(millions) || millions < 1) continue
      rows.push({ title, copies: Math.round(millions * 1e6), year, source: 'wikipedia' })
    }
  }
  return rows
}

async function main() {
  const dry = process.argv.includes('--dry')
  const catalog = await readCatalog()
  const byTitle = new Map()
  for (const g of catalog) {
    if (!g.title) continue
    const k = normTitle(g.title)
    if (!byTitle.has(k)) byTitle.set(k, [])
    byTitle.get(k).push(g)
  }

  let figures = []
  try {
    const wd = await wikidata()
    console.log(`wikidata figures: ${wd.length}`)
    figures.push(...wd)
  } catch (e) {
    console.warn(`wikidata failed: ${e.message}`)
  }
  try {
    const wp = await wikipedia()
    console.log(`wikipedia figures: ${wp.length}`)
    figures.push(...wp)
  } catch (e) {
    console.warn(`wikipedia failed: ${e.message}`)
  }

  const joined = new Map() // id -> {units, source}
  const unmatched = []
  for (const f of figures) {
    const cands = byTitle.get(normTitle(f.title)) ?? []
    let hit = null
    if (f.year !== null) {
      // Statement dates are re-release years as often as not (GTA V: 2014 /
      // 2015 / 2022 for a 2013 game): exact year first, else nearest ±5.
      hit = cands.find((g) => g.year === f.year)
        ?? cands.filter((g) => Math.abs((g.year ?? f.year) - f.year) <= 5)
          .sort((a, b) => Math.abs(a.year - f.year) - Math.abs(b.year - f.year))[0]
        ?? null
    } else if (cands.length === 1) {
      hit = cands[0] // yearless figure, unambiguous title only
    }
    if (!hit) {
      unmatched.push(f)
      continue
    }
    const prev = joined.get(hit.id)
    if (!prev || f.copies > prev.units) joined.set(hit.id, { units: f.copies, source: f.source })
  }

  console.log(`\nmatched ${joined.size} pool entries from ${figures.length} figures (${catalog.length} games)`)
  const top = unmatched.sort((a, b) => b.copies - a.copies).slice(0, 15)
  if (top.length) {
    console.log('top unmatched figure-bearing titles:')
    for (const u of top) console.log(`  ${u.copies.toLocaleString('en-US')} — ${u.title}${u.year ? ` (${u.year})` : ''} [${u.source}]`)
  }
  if (dry) {
    console.log('(dry run — nothing written)')
    return
  }
  const lines = ['id\tunitsSold\tsource']
  for (const [id, r] of [...joined.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${id}\t${r.units}\t${r.source}`)
  }
  await writeFile(OUT, lines.join('\n') + '\n')
  console.log(`wrote ${joined.size} rows to src/data/sales.tsv`)
}

main()

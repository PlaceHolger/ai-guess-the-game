// Bulk importer: IGDB -> src/data/games.auto.ts (+ screenshots).
// Fills N top titles per year / company / platform, unattended. Example:
//
//   npm run import -- --years 1980-2025 --top 8        # 8 best per year
//   npm run import -- --year 1983 --top 10             # fill a gap year
//   npm run import -- --company "Sierra On-Line" --top 50
//   npm run import -- --platform "SNES" --top 30
//   npm run import -- --list-years                     # local per-year counts
//
// Flags: --top N (default 10), --min-votes N (default 20),
//        --dry (query + map, but write/download nothing), --no-shots.
//
// Ranking uses IGDB total_rating with a minimum vote count. Entries need at
// least one IGDB screenshot or they are skipped (keeps every level playable).
// Hand-written src/data/games.ts always wins dedup; existing auto entries are kept.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DATA_DIR,
  OUT_DIR,
  big,
  getCreds,
  igdb,
  matchBest,
  normTitle,
  readCatalog,
  sleep,
  twitchToken,
} from './igdb-lib.mjs'

const AUTO_FILE = path.join(DATA_DIR, 'games.auto.ts')
const GAME_FIELDS = [
  'id', 'slug', 'name', 'first_release_date', 'total_rating', 'rating_count',
  'genres.name', 'platforms.abbreviation', 'platforms.name',
  'involved_companies.company.name', 'involved_companies.publisher', 'involved_companies.developer',
  'franchises.name', 'game_engines.name',
  'screenshots.url', 'screenshots.width', 'screenshots.height',
].join(',')
const BASE_WHERE = (minVotes) =>
  `game_type = 0 & rating_count >= ${minVotes} & total_rating != null & themes != (42)`

// ---------- mapping IGDB -> our vocabulary ----------

function mapGenre(names) {
  const mapped = []
  for (const raw of names) {
    const n = raw.toLowerCase()
    let g = null
    if (/role-playing|\brpg\b/.test(n)) g = 'Role-Playing'
    else if (/real time strategy|turn-based|strategy|tactical/.test(n)) g = 'Strategy'
    else if (/shooter/.test(n)) g = 'Shooter'
    else if (/fighting/.test(n)) g = 'Fighting'
    else if (/platform/.test(n)) g = 'Platformer'
    else if (/racing/.test(n)) g = 'Racing'
    else if (/sport/.test(n)) g = 'Sports'
    else if (/puzzle/.test(n)) g = 'Puzzle'
    else if (/music/.test(n)) g = 'Music'
    else if (/moba/.test(n)) g = 'MOBA'
    else if (/simulator/.test(n)) g = 'Simulation'
    else if (/point-and-click|visual novel|adventure/.test(n)) g = 'Adventure'
    else if (/hack and slash/.test(n)) g = 'Action'
    else if (/arcade/.test(n)) g = 'Arcade'
    else if (/card/.test(n)) g = 'Card Game'
    else if (/pinball/.test(n)) g = 'Arcade'
    else if (/quiz|trivia/.test(n)) g = 'Puzzle'
    else if (/indie/.test(n)) g = null
    else g = 'Action'
    if (g) mapped.push(g)
  }
  return mapped[0] ?? 'Action'
}

const PLAT_BY_ABBR = {
  ARC: 'Arcade', '2600': 'Atari 2600', NES: 'NES', FC: 'NES', SNES: 'SNES', SFC: 'SNES',
  N64: 'N64', GB: 'Game Boy', GBC: 'Game Boy Color', GBA: 'Game Boy Advance',
  GEN: 'Genesis', MD: 'Genesis', GG: 'Game Gear', SMS: 'Master System', SAT: 'Saturn',
  DC: 'Dreamcast', PS1: 'PS1', PSX: 'PS1', PS: 'PS1', PS2: 'PS2', PS3: 'PS3', PS4: 'PS4',
  PS5: 'PS5', PSP: 'PSP', PSVITA: 'PS Vita', VITA: 'PS Vita', XB: 'Xbox', XBOX: 'Xbox',
  X360: 'Xbox 360', XONE: 'Xbox One', XSX: 'Xbox Series', XSS: 'Xbox Series',
  GC: 'GameCube', WII: 'Wii', WIIU: 'Wii U', DS: 'DS', '3DS': 'Nintendo 3DS', N3DS: 'Nintendo 3DS',
  NSW: 'Switch', SWITCH: 'Switch', WIN: 'PC', DOS: 'DOS', MAC: 'Mac', LIN: 'PC',
  FAMICOM: 'NES', FC: 'NES', FDS: 'NES', NEOGEO: 'Neo Geo', NEOGEOAES: 'Neo Geo', NEOGEOMVS: 'Neo Geo',
  SATELLAVIEW: 'SNES', BROWSER: 'Browser', BLACKBERRY: 'Mobile', BBD: 'Mobile',
  SIXTYFOURDD: 'N64', X1: 'Sharp X1', VIC20: 'Vic-20', NGAGE: 'N-Gage',
  ATARI2600: 'Atari 2600', ATARI7800: 'Atari 7800', TURBOGRAFX16: 'TurboGrafx-16',
  ASTROCADE: 'Astrocade', PDP11: 'PDP-11', SEGA32: '32X', ZOD: 'Zodiac', SMS: 'Master System',
  IOS: 'Mobile', AND: 'Mobile', C64: 'Commodore 64', AMIGA: 'Amiga', AST: 'Atari ST',
  A2: 'Apple II', A2GS: 'Apple IIGS', MSX: 'MSX', MSX2: 'MSX', ZX: 'ZX Spectrum',
  NEO: 'Neo Geo', NGPC: 'Neo Geo Pocket', TG16: 'TurboGrafx-16', PCE: 'TurboGrafx-16',
  TGCD: 'TurboGrafx-CD', WS: 'WonderSwan', VB: 'Virtual Boy', '3DO': '3DO',
  JAG: 'Atari Jaguar', LYNX: 'Atari Lynx', '32X': '32X', SCD: 'Sega CD', ATARI2600: 'Atari 2600',
  COLECOVISION: 'ColecoVision', CV: 'ColecoVision', INTV: 'Intellivision',
  A5200: 'Atari 5200', A7800: 'Atari 7800', C16: 'Commodore 16', VIC20: 'Vic-20',
  TI99: 'TI-99', AMSTRAD: 'Amstrad CPC', CPC: 'Amstrad CPC', BBCMICRO: 'BBC Micro',
  BBC: 'BBC Micro', PC88: 'PC-88', PC8800: 'PC-88', PC98: 'PC-98', PC9800: 'PC-98',
  X68K: 'X68000', FMT: 'FM Towns', ATARI8BIT: 'Atari 8-bit', A8BIT: 'Atari 8-bit',
  SG1000: 'SG-1000', CD32: 'Amiga CD32', NGAGE: 'N-Gage', DINGOO: 'Dingoo',
}

function mapPlatform(abbr, name) {
  const a = (abbr ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (PLAT_BY_ABBR[a]) return PLAT_BY_ABBR[a]
  const n = (name ?? '').toLowerCase()
  if (n.includes('xbox series')) return 'Xbox Series'
  if (n.includes('xbox one')) return 'Xbox One'
  if (n.includes('xbox 360')) return 'Xbox 360'
  if (n.includes('xbox')) return 'Xbox'
  if (n.includes('playstation 5')) return 'PS5'
  if (n.includes('playstation 4')) return 'PS4'
  if (n.includes('playstation 3')) return 'PS3'
  if (n.includes('playstation 2')) return 'PS2'
  if (n.includes('playstation vr') || n.includes('vr')) return 'VR'
  if (n.includes('playstation')) return 'PS1'
  if (n.includes('switch 2')) return 'Switch 2'
  if (n.includes('switch')) return 'Switch'
  if (n.includes('wii u')) return 'Wii U'
  if (n.includes('wii')) return 'Wii'
  if (n.includes('windows') || n.includes('linux')) return 'PC'
  if (n.includes('dos')) return 'DOS'
  if (n.includes('mac')) return 'Mac'
  if (n.includes('ios') || n.includes('android')) return 'Mobile'
  if (n.includes('nintendo 3ds')) return 'Nintendo 3DS'
  if (n.includes('nintendo ds')) return 'DS'
  if (n.includes('gamecube')) return 'GameCube'
  if (n.includes('dreamcast')) return 'Dreamcast'
  if (n.includes('saturn')) return 'Saturn'
  if (n.includes('genesis') || n.includes('mega drive')) return 'Genesis'
  if (n.includes('game gear')) return 'Game Gear'
  if (n.includes('master system')) return 'Master System'
  if (n.includes('super nintendo') || n.includes('super famicom')) return 'SNES'
  if (n.includes('nintendo 64')) return 'N64'
  if (n.includes('game boy advance')) return 'Game Boy Advance'
  if (n.includes('game boy color')) return 'Game Boy Color'
  if (n.includes('game boy')) return 'Game Boy'
  if (n.includes('entertainment system') || n.includes('famicom')) return 'NES'
  if (n.includes('commodore')) return 'Commodore 64'
  if (n.includes('amiga')) return 'Amiga'
  if (n.includes('atari st')) return 'Atari ST'
  if (n.includes('apple ii')) return 'Apple II'
  if (n.includes('msx')) return 'MSX'
  if (n.includes('spectrum')) return 'ZX Spectrum'
  if (n.includes('arcade')) return 'Arcade'
  if (n.includes('super famicom')) return 'SNES'
  if (n.includes('famicom')) return 'NES'
  if (n.includes('neo geo')) return 'Neo Geo'
  if (n.includes('satellaview')) return 'SNES'
  if (n.includes('browser')) return 'Browser'
  if (n.includes('blackberry')) return 'Mobile'
  if (n.includes('nintendo 3ds')) return 'Nintendo 3DS'
  if (n.includes('sg-1000') || n.includes('sg1000')) return 'SG-1000'
  if (n.includes('sharp x1')) return 'Sharp X1'
  if (n.includes('64dd')) return 'N64'
  if (n.includes('n-gage')) return 'N-Gage'
  if (n.includes('vic-20') || n.includes('vic20')) return 'Vic-20'
  if (n.includes('turbografx')) return 'TurboGrafx-16'
  if (n.includes('astrocade')) return 'Astrocade'
  if (n.includes('vectrex')) return 'Vectrex'
  if (n.includes('zeebo')) return 'Zeebo'
  if (n.includes('ouya')) return 'Ouya'
  if (n.includes('stadia')) return 'Stadia'
  if (n.includes('onlive')) return 'OnLive'
  if (n.includes('philips')) return 'Philips CD-i'
  if (n.includes('trs-80') || n.includes('trs80')) return 'TRS-80'
  if (n.includes('fm-7') || n.includes('fm7')) return 'FM-7'
  if (n.includes('dvd player')) return 'DVD Player'
  if (n.includes('master system')) return 'Master System'
  if (n.includes('n-gage')) return 'N-Gage'
  if (n.includes('colecovision')) return 'ColecoVision'
  if (n.includes('intellivision')) return 'Intellivision'
  if (n.includes('amstrad') || n.includes(' cpc')) return 'Amstrad CPC'
  if (n.includes('bbc micro')) return 'BBC Micro'
  if (n.includes('commodore 64') || n === 'c64') return 'Commodore 64'
  if (n.includes('zx spectrum')) return 'ZX Spectrum'
  if (n.includes('msx')) return 'MSX'
  if (n.includes('apple ii')) return 'Apple II'
  if (n.includes('atari st')) return 'Atari ST'
  if (n.includes('atari 8-bit')) return 'Atari 8-bit'
  if (n.includes('atari 2600')) return 'Atari 2600'
  if (n.includes('pc-88') || n.includes('pc-8800')) return 'PC-88'
  if (n.includes('pc-98') || n.includes('pc-9800')) return 'PC-98'
  return abbr || name || 'PC'
}

function companyOf(ics, role) {
  const hit = (ics ?? []).find((c) => c[role] && c.company?.name) ?? (ics ?? []).find((c) => c.company?.name)
  return hit?.company?.name ?? 'Unknown'
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 }
const ARABIC = Object.fromEntries(Object.entries(ROMAN).map(([r, a]) => [String(a), r.toUpperCase()]))

function autoAliases(title) {
  const out = new Set()
  const words = title.split(/\s+/)
  const stop = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'on', 'for', 'to', 'with', 'vs'])
  const acr = words.filter((w) => w.length > 2 && !stop.has(w.toLowerCase())).map((w) => w[0]).join('').toLowerCase()
  if (acr.length >= 2 && acr.length <= 5) out.add(acr)
  for (const w of words) {
    const low = w.toLowerCase().replace(/[^a-z]/g, '')
    if (ROMAN[low]) out.add(words.map((x) => (x === w ? ROMAN[low] : x)).join(' ').toLowerCase())
    const num = w.replace(/[^0-9]/g, '')
    if (num && ARABIC[num]) out.add(words.map((x) => (x === w ? ARABIC[num] : x)).join(' ').toLowerCase())
  }
  out.delete(normTitle(title))
  return [...out]
}

function isSubtitleDupe(na, nb) {
  // Same game with an edition subtitle? ("warcraftiii" vs "warcraftiiireignofchaos").
  // Numerals and short stubs never count (FF VII != FF I, GTA Vice City != GTA).
  if (na === nb) return true
  const [short, long] = na.length < nb.length ? [na, nb] : [nb, na]
  if (short.length < 8 || !long.startsWith(short)) return false
  const rest = long.slice(short.length)
  if (rest.length <= 2 || /[0-9]/.test(rest)) return false
  if (/^[ivxlcdm]+$/.test(rest)) return false // roman numeral, e.g. vii
  return true
}

// values that are not platforms at all (chips, peripherals) — dropped
const DROP_PLATFORMS = new Set(['AY-3-8606', 'PocketStation'])

function canonFranchise(n) {
  let out = (n ?? '').replace(/^The\s+/i, '')
  out = out.replace(/^Mario Bros\.?$/, 'Mario').replace(/^Super Mario$/, 'Mario')
  out = out.replace(/^The Legend of Zelda$/, 'Zelda')
  return out
}

function toEntry(g) {
  const year = new Date(g.first_release_date * 1000).getUTCFullYear()
  const plats = [...new Set((g.platforms ?? []).map((p) => mapPlatform(p.abbreviation, p.name)))].filter((p) => !DROP_PLATFORMS.has(p)).slice(0, 3)
  const franchise = (g.franchises ?? [])[0]?.name ? canonFranchise((g.franchises ?? [])[0].name) : null
  const engine = (g.game_engines ?? [])[0]?.name ?? null
  return {
    id: g.slug,
    title: g.name,
    year,
    genre: mapGenre((g.genres ?? []).map((x) => x.name)),
    publisher: companyOf(g.involved_companies, 'publisher'),
    developer: companyOf(g.involved_companies, 'developer'),
    platforms: plats.length ? plats : ['PC'],
    aliases: autoAliases(g.name),
    igdbQuery: g.name.replace(/"/g, ''),
    igdbId: g.id,
    screenshot: `/screenshots/${year}/${g.slug}.jpg`,
    ...(franchise ? { franchise } : {}),
    ...(engine ? { engine } : {}),
    _shots: (g.screenshots ?? []).map((s) => ({ url: s.url, w: s.width ?? 0 })),
  }
}

// ---------- CLI ----------

function args() {
  const a = { top: 10, minVotes: 20, dry: false, shots: true }
  const raw = process.argv.slice(2)
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]
    if (t === '--year') a.year = Number(raw[++i])
    else if (t === '--years') { const [f, l] = raw[++i].split('-').map(Number); a.years = [f, l] }
    else if (t === '--company') a.company = raw[++i]
    else if (t === '--platform') a.platform = raw[++i]
    else if (t === '--franchise') a.franchise = raw[++i]
    else if (t === '--engine') a.engine = raw[++i]
    else if (t === '--title') a.title = raw[++i]
    else if (t === '--top') a.top = Number(raw[++i])
    else if (t === '--min-votes') a.minVotes = Number(raw[++i])
    else if (t === '--dry') a.dry = true
    else if (t === '--no-shots') a.shots = false
    else if (t === '--list-years') a.listYears = true
    else if (t === '--enrich') a.enrich = true
    else if (t === '--limit') a.limit = Number(raw[++i])
    else { console.error(`unknown arg: ${t}`); process.exit(1) }
  }
  return a
}

async function resolveId(endpoint, query, clientId, token) {
  const q = query.toLowerCase()
  const rank = (hits) =>
    hits.find((h) => (h.name ?? '').toLowerCase() === q || (h.abbreviation ?? '').toLowerCase() === q) ??
    hits.find((h) => (h.name ?? '').toLowerCase().startsWith(q)) ??
    hits[0] ?? null
  if (endpoint === 'platforms') {
    return rank(await igdb(endpoint, `search "${query}"; fields id,name,abbreviation; limit 10;`, clientId, token))
  }
  // companies, franchises, game_engines have no search support — fuzzy name match
  const hits = await igdb(endpoint, `fields id,name; where name ~ *"${query}"*; limit 50;`, clientId, token)
  return rank(hits)
}

async function queryGames(where, top, clientId, token) {
  const all = []
  for (let off = 0; off < top; off += 500) {
    const batch = await igdb('games', `fields ${GAME_FIELDS}; where ${where}; sort total_rating desc; limit ${Math.min(500, top - off)}; offset ${off};`, clientId, token)
    all.push(...batch)
    if (batch.length < Math.min(500, top - off)) break
    await sleep(300)
  }
  return all
}

const yearWhere = (y0, y1, minVotes) =>
  `first_release_date >= ${Date.UTC(y0, 0, 1) / 1000} & first_release_date < ${Date.UTC(y1 + 1, 0, 1) / 1000} & ${BASE_WHERE(minVotes)}`

const BLANK = (v) => !v || /^unknown$/i.test(v)

// Fill blank metadata (genre/publisher/developer/platforms) from IGDB.
// Display title/year are NEVER touched — your TSV title stays the display
// title, the IGDB hit only donates facts you left empty.
function fullMeta() {
  const out = new Map()
  const put = (id, e) => { if (id && !out.has(id)) out.set(id, { id, ...e }) }
  for (const f of ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, f)
    if (!existsSync(p)) continue
    const t = readFileSync(p, 'utf8')
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      const b = m[0]
      const id = b.match(/id:\s*'([^']+)'/)?.[1] ?? b.match(/"id"\s*:\s*"([^"]+)"/)?.[1]
      if (!id) continue
      const str = (n) => b.match(new RegExp(`${n}:\\s*'([^']+)'`))?.[1] ?? b.match(new RegExp(`"${n}"\\s*:\\s*"([^"]+)"`))?.[1] ?? ''
      const pm = b.match(/"?platforms"?\s*:\s*\[([^\]]*)\]/)
      put(id, {
        file: p, block: true,
        title: str('title'), year: Number(b.match(/year:\s*(\d+)/)?.[1] ?? b.match(/"year"\s*:\s*(\d+)/)?.[1]) || undefined,
        genre: str('genre'), publisher: str('publisher'), developer: str('developer'),
        platforms: pm ? [...pm[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : [],
      })
    }
  }
  const tsv = path.join(DATA_DIR, 'games.tsv')
  if (existsSync(tsv)) {
    const lines = readFileSync(tsv, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!i || !line.trim()) return
      const c = line.split('\t')
      if (c.length < 11) return
      put(c[0].trim(), {
        file: tsv, tsvLine: i,
        title: c[1].trim(), year: Number(c[2]) || undefined,
        genre: c[3].trim(), publisher: c[4].trim(), developer: c[5].trim(),
        platforms: c[6].split('|').map((s) => s.trim()).filter(Boolean),
      })
    })
  }
  return out
}

function qq(s) {
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`
}

async function patchEntry(e, fill) {
  if (e.tsvLine !== undefined) {
    const lines = (await readFile(e.file, 'utf8')).split('\n')
    const cells = lines[e.tsvLine].split('\t')
    if (fill.genre) cells[3] = fill.genre
    if (fill.publisher) cells[4] = fill.publisher
    if (fill.developer) cells[5] = fill.developer
    if (fill.platforms) cells[6] = fill.platforms.join('|')
    lines[e.tsvLine] = cells.join('\t')
    await writeFile(e.file, lines.join('\n'))
    return 'tsv'
  }
  let t = await readFile(e.file, 'utf8')
  const m = t.match(new RegExp(`\\{[^{}]*?(?:id:\\s*'${e.id}'|"id"\\s*:\\s*"${e.id}")[^{}]*?\\}`))
  if (!m) return null
  let b = m[0]
  for (const [k, v] of Object.entries(fill)) {
    if (k === 'platforms') {
      const items = v.map((s) => (s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`)).join(', ')
      const itemsJ = v.map((s) => `"${s.replace(/"/g, '')}"`).join(', ')
      if (new RegExp(`${k}:\\s*\\[`).test(b)) b = b.replace(new RegExp(`(${k}:\\s*\\[)[^\\]]*(\\])`), `$1${items}$2`)
      else b = b.replace(new RegExp(`("${k}"\\s*:\\s*\\[)[^\\]]*(\\])`), `$1${itemsJ}$2`)
    } else {
      if (new RegExp(`${k}:\\s*'`).test(b)) b = b.replace(new RegExp(`(${k}:\\s*')[^']*(')`), `$1${v.replace(/'/g, "\\'")}$2`)
      else b = b.replace(new RegExp(`("${k}"\\s*:\\s*")[^"]*(")`), `$1${v.replace(/"/g, '')}$2`)
    }
  }
  await writeFile(e.file, t.replace(m[0], b))
  return 'ts'
}

async function enrich(a) {
  const targets = [...(await fullMeta()).values()].filter(
    (e) => e.title && (BLANK(e.genre) || BLANK(e.publisher) || BLANK(e.developer) || !e.platforms.length),
  )
  const scoped = a.limit ? targets.slice(0, a.limit) : targets
  console.log(`${targets.length} entries with blank fields${a.limit ? ` (processing ${scoped.length})` : ''}`)
  if (!targets.length) return
  const { clientId, secret } = await getCreds()
  const token = await twitchToken(clientId, secret)
  let filled = 0
  let tsvTouched = false
  for (const e of scoped) {
    let hits = []
    try {
      hits = await igdb('games', `search "${e.title.replace(/"/g, '')}"; fields ${GAME_FIELDS}; limit 20;`, clientId, token)
    } catch (err) {
      console.warn(`query failed ${e.id}: ${err.message}`)
      continue
    }
    const best = matchBest(hits.filter((h) => h.first_release_date), { query: e.title, title: e.title, year: e.year })
    if (!best) {
      console.log(`no match: ${e.id} ("${e.title}", ${e.year})`)
      continue
    }
    const mapped = toEntry(best.c)
    const fill = {}
    if (BLANK(e.genre) && !BLANK(mapped.genre)) fill.genre = mapped.genre
    if (BLANK(e.publisher) && !BLANK(mapped.publisher)) fill.publisher = mapped.publisher
    if (BLANK(e.developer) && !BLANK(mapped.developer)) fill.developer = mapped.developer
    if (!e.platforms.length && mapped.platforms.length) fill.platforms = mapped.platforms
    if (!Object.keys(fill).length) {
      console.log(`nothing to fill: ${e.id} (IGDB has no better data)`)
      continue
    }
    console.log(`${a.dry ? 'would fill' : 'fill'} ${e.id} <- "${best.c.name}": ${JSON.stringify(fill)}`)
    if (!a.dry) {
      const where = await patchEntry(e, fill)
      if (where === 'tsv') tsvTouched = true
      filled++
    }
    await sleep(300)
  }
  if (a.dry) console.log('(dry run — nothing written)')
  else console.log(`filled ${filled} entries${tsvTouched ? ' — run npm run data:build to regenerate' : ''}`)
}

async function main() {
  const a = args()

  if (a.listYears) {
    const counts = {}
    for (const g of await readCatalog()) {
      if (g.year) counts[g.year] = (counts[g.year] || 0) + 1
    }
    for (const y of Object.keys(counts).map(Number).sort((x, y) => x - y)) console.log(`${y}: ${counts[y]}`)
    return
  }
  if (a.enrich) {
    await enrich(a)
    return
  }
  if (!a.year && !a.years && !a.company && !a.platform && !a.franchise && !a.engine && !a.title) {
    console.error('Pick a scope: --year YYYY | --years A-B | --company NAME | --platform NAME | --franchise NAME | --engine NAME | --title NAME [--year YYYY] | --enrich  (+ --top N, --min-votes N, --dry, --no-shots)')
    process.exit(1)
  }

  const { clientId, secret } = await getCreds()
  const token = await twitchToken(clientId, secret)

  // collect candidate IGDB games per scope
  const seen = new Set()
  const candidates = []
  const push = (games, label) => {
    let n = 0
    for (const g of games) {
      if (seen.has(g.id)) continue
      seen.add(g.id)
      candidates.push(g)
      n++
    }
    console.log(`${label}: ${n} new candidates`)
  }

  if (a.years) {
    const [from, to] = a.years
    for (let y = from; y <= to; y++) {
      push(await queryGames(yearWhere(y, y, a.minVotes), a.top, clientId, token), `${y}`)
      await sleep(300)
    }
  } else if (a.year && !a.title) {
    push(await queryGames(yearWhere(a.year, a.year, a.minVotes), a.top, clientId, token), `${a.year}`)
  }
  if (a.company) {
    const c = await resolveId('companies', a.company, clientId, token)
    if (!c) { console.error(`company not found: ${a.company}`); process.exit(1) }
    console.log(`company: ${c.name} (${c.id})`)
    const links = await igdb('involved_companies', `fields game; where company = ${c.id}; limit 500;`, clientId, token)
    const ids = [...new Set(links.map((l) => l.game).filter(Boolean))].slice(0, 500)
    if (ids.length) {
      const games = await queryGames(`id = (${ids.join(',')}) & ${BASE_WHERE(a.minVotes)}`, a.top, clientId, token)
      push(games, `company ${c.name}`)
    }
  }
  if (a.platform) {
    const p = await resolveId('platforms', a.platform, clientId, token)
    if (!p) { console.error(`platform not found: ${a.platform}`); process.exit(1) }
    console.log(`platform: ${p.name} (${p.id})`)
    push(await queryGames(`platforms = [${p.id}] & ${BASE_WHERE(a.minVotes)}`, a.top, clientId, token), `platform ${p.name}`)
  }
  if (a.franchise) {
    const f = await resolveId('franchises', a.franchise, clientId, token)
    if (!f) { console.error(`franchise not found: ${a.franchise}`); process.exit(1) }
    console.log(`franchise: ${f.name} (${f.id})`)
    push(await queryGames(`franchises = [${f.id}] & ${BASE_WHERE(a.minVotes)}`, a.top, clientId, token), `franchise ${f.name}`)
  }
  if (a.engine) {
    const e = await resolveId('game_engines', a.engine, clientId, token)
    if (!e) { console.error(`engine not found: ${a.engine}`); process.exit(1) }
    console.log(`engine: ${e.name} (${e.id})`)
    push(await queryGames(`game_engines = [${e.id}] & ${BASE_WHERE(a.minVotes)}`, a.top, clientId, token), `engine ${e.name}`)
  }
  if (a.title) {
    // targeted single-game import (fills named gaps). --year disambiguates.
    const found = await igdb('games', `search "${a.title.replace(/"/g, '')}"; fields ${GAME_FIELDS}; limit 10;`, clientId, token)
    let cands = found.filter((x) => x.screenshots?.length)
    if (a.year) {
      cands = cands.filter((x) => {
        const cy = x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null
        return cy !== null && Math.abs(cy - a.year) <= 1
      })
    }
    push(cands.slice(0, 3), `title ${a.title}`)
  }

  // dedup against catalog (hand list wins)
  const catalog = await readCatalog()
  const haveIds = new Set(catalog.map((g) => g.id))
  const haveTitles = catalog.filter((g) => g.title && g.year).map((g) => ({ n: normTitle(g.title), y: g.year }))
  const fresh = []
  for (const g of candidates) {
    if (!g.first_release_date || !(g.screenshots ?? []).length) continue
    const e = toEntry(g)
    const en = normTitle(e.title)
    if (haveIds.has(e.id)) continue
    if (haveTitles.some((h) => h.y === e.year && isSubtitleDupe(en, h.n))) continue
    haveIds.add(e.id)
    haveTitles.push({ n: en, y: e.year })
    fresh.push(e)
  }
  console.log(`\n${fresh.length} fresh entries (${candidates.length - fresh.length} skipped: dupes or no screenshots)`)
  for (const e of fresh) {
    console.log(`+ ${e.year} ${e.id} [${e.genre} | ${e.publisher} | ${e.platforms.join('/')}] (${e._shots.length} shots)`)
  }
  if (!fresh.length || a.dry) {
    if (a.dry) console.log('(dry run — nothing written)')
    return
  }

  // screenshots
  if (a.shots) {
    for (const e of fresh) {
      const dir = path.join(OUT_DIR, String(e.year))
      await mkdir(dir, { recursive: true })
      const dest = path.join(dir, `${e.id}.jpg`)
      if (existsSync(dest)) { console.log(`skip shot ${e.id} (exists)`); continue }
      const shots = [...e._shots].sort((x, y) => y.w - x.w)
      try {
        const buf = Buffer.from(await (await fetch(big(shots[0].url))).arrayBuffer())
        const { writeFile: wf } = await import('node:fs/promises')
        await wf(dest, buf)
        console.log(`saved ${e.id}`)
      } catch (err) {
        console.warn(`shot failed ${e.id}: ${err.message}`)
      }
      await sleep(300)
    }
  }

  // append entries (without the internal _shots field) into the LAST part
  // array (auto file is chunked to keep tsc happy — see chunk-auto docs)
  const clean = fresh.map(({ _shots, ...rest }) => rest)
  const lines = clean.map((e) => '  ' + JSON.stringify(e))
  let text = await readFile(AUTO_FILE, 'utf8')
  const partRe = /const (AUTO_\d+): GameEntry\[\] = \[/g
  let lastPart = null
  let m
  while ((m = partRe.exec(text)) !== null) lastPart = { name: m[1], index: m.index }
  if (!lastPart) throw new Error(`${AUTO_FILE} has unexpected format (no AUTO_N part)`)
  const exportLine = text.lastIndexOf('export const AUTO_GAMES')
  if (exportLine < 0 || !text.trimEnd().endsWith('];')) throw new Error(`${AUTO_FILE} has unexpected format`)
  // count entries in the last part; roll a new part past CHUNK entries
  const CHUNK = 250
  const tail = text.slice(lastPart.index, exportLine)
  const tailCount = (tail.match(/"id":/g) || []).length
  if (tailCount + clean.length <= CHUNK) {
    const anchorRe = /\n\];\nexport const AUTO_GAMES/
    const am = text.match(anchorRe)
    if (!am || am.index === undefined) throw new Error(`${AUTO_FILE} has unexpected format`)
    const at = am.index
    const before = text.slice(0, at).trimEnd()
    const sep = before.endsWith('[') ? '\n' : ',\n'
    const rest = text.slice(at + am[0].length)
    await writeFile(AUTO_FILE, `${before}${sep}${lines.join(',\n')}\n];\nexport const AUTO_GAMES${rest}`)
  } else {
    const n = Number(lastPart.name.split('_')[1]) + 1
    const names = [...text.matchAll(/const (AUTO_\d+): GameEntry\[\]/g)].map((x) => x[1])
    names.push(`AUTO_${n}`)
    const part = `const AUTO_${n}: GameEntry[] = [\n${lines.join(',\n')}\n];`
    const expRe = /export const AUTO_GAMES[^;]*;/
    const next = text.replace(expRe, `export const AUTO_GAMES: GameEntry[] = [${names.map((x) => `...${x}`).join(', ')}];`)
    const at = next.lastIndexOf('export const AUTO_GAMES')
    await writeFile(AUTO_FILE, `${next.slice(0, at)}${part}\n\n${next.slice(at)}`)
  }
  console.log(`\nappended ${clean.length} entries to src/data/games.auto.ts`)
}

main()

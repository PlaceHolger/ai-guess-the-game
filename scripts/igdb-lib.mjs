// Shared IGDB helpers for scripts/fetch-igdb.mjs and scripts/import-igdb.mjs.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(process.cwd())
export const DATA_DIR = path.join(ROOT, 'src', 'data')
export const OUT_DIR = path.join(ROOT, 'public', 'screenshots')

/** rating_count floor for the mainstream default pool (shared by the
 *  importer and backfill-auto so both classify identically). */
export const VOTES_POPULAR = 25

/** Hand-list membership: games.tsv is the source of truth for these ids —
 *  edits must go to the TSV row, never to generated games.hand.ts (which
 *  data:build overwrites on every dev/build). */
export async function isHandId(id) {
  try {
    const tsv = await readFile(path.join(DATA_DIR, 'games.tsv'), 'utf8')
    return tsv.split('\n').some((l) => l.split('\t')[0] === id)
  } catch {
    return false
  }
}

/** Rewrite one TSV cell (0-based column index) for a hand id. */
export async function setTsvCell(id, col, value) {
  const p = path.join(DATA_DIR, 'games.tsv')
  const lines = (await readFile(p, 'utf8')).split('\n')
  const i = lines.findIndex((l) => l.split('\t')[0] === id)
  if (i < 0) return false
  const cells = lines[i].split('\t')
  while (cells.length <= col) cells.push('')
  cells[col] = value
  const { writeFile } = await import('node:fs/promises')
  await writeFile(p, lines.join('\n'))
  return true
}

export function loadDotEnv() {
  const p = path.join(ROOT, '.env')
  if (!existsSync(p)) return Promise.resolve({})
  return readFile(p, 'utf8')
    .then((t) =>
      Object.fromEntries(
        t.split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => {
            const i = l.indexOf('=')
            return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
          }),
      ),
    )
    .catch(() => ({}))
}

export async function getCreds() {
  const env = { ...process.env, ...(await loadDotEnv()) }
  const clientId = env.IGDB_CLIENT_ID
  const secret = env.IGDB_CLIENT_SECRET
  if (!clientId || !secret) {
    console.error('Missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET. Copy .env.example to .env first.')
    process.exit(1)
  }
  return { clientId, secret }
}

export async function twitchToken(id, secret) {
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}` +
      `&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
    { method: 'POST' },
  )
  if (!r.ok) throw new Error(`twitch token failed: ${r.status} ${await r.text()}`)
  return (await r.json()).access_token
}

export async function igdb(pathname, body, clientId, token) {
  const r = await fetch(`https://api.igdb.com/v4/${pathname}`, {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body,
  })
  if (!r.ok) throw new Error(`igdb ${pathname} failed: ${r.status} ${await r.text()}`)
  return r.json()
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const big = (url) => (url.startsWith('//') ? 'https:' + url : url).replace('t_thumb', 't_1080p')

/** Read every game entry (hand + auto + custom) for listing, dedup and screenshot fetching. */
export async function readCatalog() {
  const out = []
  for (const file of ['games.ts', 'games.hand.ts', 'games.auto.ts', 'games.custom.ts']) {
    const p = path.join(DATA_DIR, file)
    if (!existsSync(p)) continue
    out.push(...parseBlocks(await readFile(p, 'utf8')))
  }
  return out
}

function field(block, name) {
  // hand file: TS literals, bare keys, single- or double-quoted values.
  // auto file: JSON, quoted keys, quoted strings or bare numbers.
  return block.match(new RegExp(`${name}:\\s*'([^']+)'`))?.[1]
    ?? block.match(new RegExp(`${name}:\\s*"([^"]+)"`))?.[1]
    ?? block.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`))?.[1]
    ?? block.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`))?.[1]
    ?? block.match(new RegExp(`${name}:\\s*(\\d+)`))?.[1]
}

function parseBlocks(ts) {
  // Each entry is a single {...} object literal. Parse per-block so a
  // different quote style in one entry can never swallow the whole file.
  // Full-line // comments are stripped first (games.custom.ts has an example).
  const code = ts.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
  const out = []
  for (const m of code.matchAll(/\{[^{}]*\}/g)) {
    const block = m[0]
    const id = field(block, 'id')
    if (!id) continue
    out.push({
      id,
      query: field(block, 'igdbQuery'),
      year: Number(field(block, 'year')) || undefined,
      title: field(block, 'title'),
      igdbId: Number(field(block, 'igdbId')) || undefined,
      shot: field(block, 'screenshot'),
      alts: [...(block.match(/"?altScreenshots"?\s*:\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]),
      remote: field(block, 'remote'),
      remoteAlts: [...(block.match(/"?remoteAlts"?\s*:\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]),
    })
  }
  return out
}

export function looksRelated(query, name) {
  const stop = new Set(['the', 'and', 'of'])
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
  const n = name.toLowerCase()
  return words.some((w) => n.includes(w))
}

export function normTitle(t) {
  return (t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
}

/** Rank IGDB search candidates against our entry. Returns best or null.
 *  Tiers: exact title + right year > exact title (any year) > fuzzy + right
 *  year. Anything else is rejected — better to skip than to save a wrong game.
 *  (Exact beats fuzzy even across years: "Minecraft" 2009 beats the related
 *  "Minecraft Tower Defence" 2012; year decides between exact duplicates.) */
export function matchBest(cands, { query, title, year }) {
  const nq = normTitle(query)
  const nt = normTitle(title ?? query)
  const ranked = cands
    .map((c) => {
      const nn = normTitle(c.name)
      const cy = c.first_release_date ? new Date(c.first_release_date * 1000).getUTCFullYear() : null
      const exact = nn === nq || nn === nt
      const related = looksRelated(query, c.name) || (title && title !== query && looksRelated(title, c.name))
      const yearOk = cy !== null && year ? Math.abs(cy - year) <= 1 : false
      const tier = exact ? (yearOk ? 0 : 1) : (related && yearOk ? 2 : 3)
      return { c, cy, exact, related, yearOk, tier }
    })
    .sort((a, b) => a.tier - b.tier)
  const best = ranked[0]
  if (!best || best.tier > 2) return null
  return best
}

export function isSubtitleDupe(na, nb) {
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

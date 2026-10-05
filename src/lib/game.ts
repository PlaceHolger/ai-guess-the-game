import { GAMES, type GameEntry } from '../data/games'
import { SALES } from '../data/sales'

export interface PixelLevel {
  /** grid width in cells (height follows the shot aspect), 0 = full resolution */
  size: number
  points: number
}

// Reveal tiers by grid width: 16 -> 32 -> 48 -> 64 -> 96 -> full. The grid
// height follows the shot aspect (16x9 tiers on widescreen); points drop
// 500 / 400 / 300 / 200 / 100 / 50 per reveal.
export const LEVELS: PixelLevel[] = [
  { size: 16, points: 500 },
  { size: 32, points: 400 },
  { size: 48, points: 300 },
  { size: 64, points: 200 },
  { size: 96, points: 100 },
  { size: 0, points: 50 },
]

export function levelLabel(level: PixelLevel): string {
  return level.size === 0 ? 'Full' : `${level.size}×${level.size}`
}

/** Honest grid label for the level chips: the pixel grid follows the
 *  screenshot aspect (96x54 for 16:9), so labels adapt once known. */
export function gridLabel(size: number, aspect: number | null): string {
  if (size === 0) return 'Full'
  if (!aspect || !(aspect > 0)) return `${size}×${size}`
  if (aspect >= 1) return `${size}×${Math.max(1, Math.round(size / aspect))}`
  return `${Math.max(1, Math.round(size * aspect))}×${size}`
}

export function pointsForLevel(idx: number): number {
  return LEVELS[Math.min(idx, LEVELS.length - 1)].points
}

/** Points after hint stages: each of the two hints (year, then title shape)
 *  halves the level points, floored at 10 so a late hint never zeroes you. */
export function earnedPoints(levelIdx: number, hintStage: number): number {
  return Math.max(10, Math.floor(pointsForLevel(levelIdx) / 2 ** hintStage))
}

export function randomGame(excludeId?: string): GameEntry {
  // GAMES is compile-time non-empty (data integrity test enforces entries)
  return randomFrom(GAMES, excludeId)!
}

/** Random entry from a filtered pool (e.g. active category filters). */
export function randomFrom(pool: GameEntry[], excludeId?: string): GameEntry | undefined {
  const list = excludeId && pool.length > 1 ? pool.filter((g) => g.id !== excludeId) : pool
  if (list.length === 0) return undefined
  return list[Math.floor(Math.random() * list.length)]
}

/** Fresh-first ordering for picks: never-played (any session) first, then
 *  seen-in-past-sessions, then seen-this-session. Fixes "same games again"
 *  across reloads; rotation within a game stays per appearance. */
export function preferFresh<T extends { id: string }>(
  pool: T[],
  session: Set<string>,
  persisted: Set<string>,
): T[] {
  const groups: [T[], T[], T[]] = [[], [], []]
  for (const g of pool) {
    groups[session.has(g.id) ? 2 : persisted.has(g.id) ? 1 : 0].push(g)
  }
  return [...shuffle(groups[0]), ...shuffle(groups[1]), ...shuffle(groups[2])]
}

export const YEAR_MIN = 1970
export const YEAR_MAX = 2026

/** Pool context for a share link: active package + non-default filters so
 *  the recipient's "next random" stays in the same universe. */
export interface SharePool {
  pkg: string | null
  genres: string[]
  publishers: string[]
  platforms: string[]
  developers: string[]
  franchises: string[]
  showNiche: boolean
  ymin: number
  ymax: number
}

/** Shareable link that opens exactly one level, plus its pool context
 *  (package, years, niche flag, non-empty facets — all optional) and,
 *  optionally, the exact screenshot to open (rotation position). */
export function shareLink(gameId: string, pool?: SharePool | null, shot?: number | null): string {
  const url = new URL(window.location.href)
  url.searchParams.set('game', gameCode(gameId))
  for (const k of ['pkg', 'g', 'pub', 'plat', 'dev', 'fr', 'niche', 'ymin', 'ymax', 'round', 'i', 's']) {
    url.searchParams.delete(k)
  }
  if (pool) {
    if (pool.pkg) url.searchParams.set('pkg', pool.pkg)
    if (pool.showNiche) url.searchParams.set('niche', '1')
    if (pool.ymin !== YEAR_MIN || pool.ymax !== YEAR_MAX) {
      url.searchParams.set('ymin', String(pool.ymin))
      url.searchParams.set('ymax', String(pool.ymax))
    }
    const facets: Array<[string, string[]]> = [
      ['g', pool.genres],
      ['pub', pool.publishers],
      ['plat', pool.platforms],
      ['dev', pool.developers],
      ['fr', pool.franchises],
    ]
    for (const [key, vals] of facets) {
      for (const v of vals) url.searchParams.append(key, v)
    }
  }
  if (shot !== undefined && shot !== null) url.searchParams.set('s', String(Math.max(0, shot)))
  return url.toString()
}

/** Shareable round link: game codes in play order + current position.
 *  Per-game screenshots ride along as `code~shotIdx` so a handpicked funny
 *  frame survives the trip. */
export function roundLink(queue: string[], idx: number, shots?: Array<number | null>): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('game')
  for (const k of ['pkg', 'g', 'pub', 'plat', 'dev', 'fr', 'niche', 'ymin', 'ymax', 'i', 'round', 's']) {
    url.searchParams.delete(k)
  }
  const refs = queue.map((id, k) => {
    const code = gameCode(id)
    const s = shots?.[k]
    return s !== undefined && s !== null ? `${code}~${Math.max(0, s)}` : code
  })
  url.searchParams.set('round', refs.join(','))
  url.searchParams.set('i', String(Math.max(0, idx)))
  return url.toString()
}

/** Resolve a ?round= link against the pool: ordered ids, clamped position,
 *  per-game screenshot positions (null = rotation default), and how many
 *  codes named games no longer in the pool (removed, typo'd, older build). */
export function findSharedRound(
  games: GameEntry[], code: string, idx: number,
): { ids: string[]; pos: number; shots: Array<number | null>; dropped: number } | null {
  const parts = code.split(',').filter(Boolean)
  const ids: string[] = []
  const shots: Array<number | null> = []
  for (const part of parts) {
    const [c, s] = part.split('~')
    const id = games.find((g) => gameCode(g.id) === c.toLowerCase())?.id
    if (!id) continue
    ids.push(id)
    const n = s === undefined || s === '' ? NaN : Number(s)
    shots.push(Number.isInteger(n) && n >= 0 ? n : null)
  }
  if (ids.length === 0) return null
  return { ids, pos: Math.min(Math.max(0, idx), ids.length - 1), shots, dropped: parts.length - ids.length }
}

/** Pool context parsed from a share link (?game= must be present). Years
 *  absent from the URL stay absent (no silent 0-0); pkg validated. */
export interface SharedPoolPatch {
  pkg: string | null
  patch: {
    genres?: string[]
    publishers?: string[]
    platforms?: string[]
    developers?: string[]
    franchises?: string[]
    showNiche?: boolean
    ymin?: number
    ymax?: number
  }
  label: string
}

/** Facet values the current pool knows (for share-link validation). The
 *  'RPG (all)'/'Shooter (all)' groups mirror GENRE_OPTIONS in App.tsx. */
function knownFacets(): Record<'genres' | 'publishers' | 'platforms' | 'developers' | 'franchises', Set<string>> {
  const genres = new Set<string>(['RPG (all)', 'Shooter (all)'])
  const publishers = new Set<string>()
  const platforms = new Set<string>(['Others'])
  const developers = new Set<string>()
  const franchises = new Set<string>()
  for (const g of GAMES) {
    genres.add(g.genre)
    publishers.add(g.publisher)
    for (const p of g.platforms) platforms.add(p)
    developers.add(g.developer)
    const f = franchiseOf(g)
    if (f) franchises.add(f)
  }
  return { genres, publishers, platforms, developers, franchises }
}
export function parseSharedPool(sp: URLSearchParams, knownPackages: string[]): SharedPoolPatch | null {  if (!sp.has('game')) return null
  const pkg = sp.get('pkg')
  const pkgKnown = !!pkg && knownPackages.includes(pkg)
  const patch: SharedPoolPatch['patch'] = {}
  if (sp.get('niche') === '1') patch.showNiche = true
  const yminRaw = sp.get('ymin')
  const ymaxRaw = sp.get('ymax')
  const ymin = yminRaw === null ? NaN : Number(yminRaw)
  const ymax = ymaxRaw === null ? NaN : Number(ymaxRaw)
  if (Number.isInteger(ymin) && Number.isInteger(ymax)) {
    const lo = Math.min(Math.max(ymin as number, YEAR_MIN), YEAR_MAX)
    const hi = Math.min(Math.max(ymax as number, YEAR_MIN), YEAR_MAX)
    patch.ymin = Math.min(lo, hi)
    patch.ymax = Math.max(lo, hi)
  }
  const lists: Array<[string, 'genres' | 'publishers' | 'platforms' | 'developers' | 'franchises']> = [
    ['g', 'genres'],
    ['pub', 'publishers'],
    ['plat', 'platforms'],
    ['dev', 'developers'],
    ['fr', 'franchises'],
  ]
  let facetCount = 0
  // Strip values the pool no longer knows (removed games, renamed facets):
  // dropping just the unknown bits degrades to a slightly broader pool,
  // while rejecting the link would lose the sender's intent entirely.
  const known = knownFacets()
  for (const [param, key] of lists) {
    const vals = sp.getAll(param).filter((v) => known[key].has(v))
    if (vals.length > 0) {
      patch[key] = vals
      facetCount += vals.length
    }
  }
  if (!pkgKnown && facetCount === 0 && !patch.showNiche && patch.ymin === undefined) return null
  const bits: string[] = []
  if (pkgKnown) bits.push(`\u{1F4E6} ${pkg}`)
  if (patch.ymin !== undefined) bits.push(`${patch.ymin}\u2013${patch.ymax}`)
  if (patch.showNiche) bits.push('niche picks')
  if (facetCount > 0) bits.push(`${facetCount} filter${facetCount > 1 ? 's' : ''}`)
  return { pkg: pkgKnown ? pkg! : null, patch, label: bits.join(' \u00B7 ') || 'shared filters' }
}

/** Group label for platforms with fewer than this many games. */
export const RARE_PLATFORM_COUNT = 5

/** Platform matching with a grouped tail: games on rare platforms match 'Others'. */
export function platformHit(gamePlatforms: string[], selected: string[], rare: string[]): boolean {
  if (selected.length === 0) return true
  return gamePlatforms.some((p) => selected.includes(p) || (selected.includes('Others') && rare.includes(p)))
}

/** Stable short code per level (7 hex chars from the id hash). Opaque in
 *  chat so the answer isn't readable; immune to pool reordering (unlike a
 *  numeric index). Not encryption — just anti-spoiler. Plain ids still load.
 */
export function gameCode(id: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < id.length; i++) {
    const ch = id.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).slice(-7)
}

/** Resolve a share code (or legacy plain id) against the pool. */
export function findSharedGame(games: GameEntry[], code: string): GameEntry | undefined {
  const hit = games.find((g) => gameCode(g.id) === code.toLowerCase())
  if (hit) return hit
  return games.find((g) => g.id === code)
}

/** Base-aware URL for a shot: remote CDN URLs pass through untouched, local
 *  `screenshots/<year>/...` paths resolve against the deploy base so the
 *  game also works under project-page URLs (e.g. /user/repo/). Accepts
 *  legacy absolute (`/screenshots/...`) entries too. */
export function resolveShot(src: string): string {
  if (/^https?:\/\//.test(src)) return src
  const base: string = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return base + src.replace(/^\//, '')
}

/** All usable shots for a game: remote CDN first (no re-hosting), then local
 *  files (offline dev), then review alternates in the same order. */
export function shotsFor(game: GameEntry): string[] {
  const shots = [game.remote ?? game.screenshot]
  if (game.remote && game.screenshot !== game.remote) shots.push(game.screenshot)
  for (const a of game.remoteAlts ?? []) if (!shots.includes(a)) shots.push(a)
  for (const a of game.altScreenshots ?? []) if (!shots.includes(a)) shots.push(a)
  return shots.map(resolveShot)
}

/** Hand-curated German studios (publisher or developer match). */
export const GERMAN_PATTERNS = [
  /deck ?13/i, /crytek/i, /piranha/i, /daedalic/i, /yager/i, /mimimi/i,
  /handygames/i, /blue byte/i, /factor ?5/i, /reakktor/i, /spellbound/i,
  /ascaron/i, /phenomic/i, /keen games/i, /black forest/i, /egosoft/i,
  /related designs/i, /cipsoft/i, /kalypso/i, /travian/i,
]

export function isGerman(g: GameEntry): boolean {
  return GERMAN_PATTERNS.some((re) => re.test(g.publisher) || re.test(g.developer))
}

const FRANCHISE_RULES: Array<[RegExp, string]> = [
  [/star wars/i, 'Star Wars'],
  [/pok[eé]mon/i, 'Pokémon'],
  [/\bmario\b/i, 'Mario'],
  [/zelda/i, 'Zelda'],
  [/final fantasy/i, 'Final Fantasy'],
  [/metal gear/i, 'Metal Gear'],
  [/resident evil/i, 'Resident Evil'],
  [/silent hill/i, 'Silent Hill'],
  [/grand theft auto|\bgta\b/i, 'Grand Theft Auto'],
  [/elder scrolls/i, 'Elder Scrolls'],
  [/fallout/i, 'Fallout'],
  [/diablo/i, 'Diablo'],
  [/warcraft/i, 'Warcraft'],
  [/starcraft/i, 'StarCraft'],
  [/\bdoom\b/i, 'DOOM'],
  [/quake/i, 'Quake'],
  [/halo/i, 'Halo'],
  [/metroid/i, 'Metroid'],
  [/castlevania/i, 'Castlevania'],
  [/mega ?man/i, 'Mega Man'],
  [/sonic/i, 'Sonic'],
  [/street fighter/i, 'Street Fighter'],
  [/mortal kombat/i, 'Mortal Kombat'],
  [/tomb raider/i, 'Tomb Raider'],
  [/mass effect/i, 'Mass Effect'],
  [/dragon age/i, 'Dragon Age'],
  [/witcher/i, 'The Witcher'],
  [/assassin'?s creed/i, "Assassin's Creed"],
  [/far cry/i, 'Far Cry'],
  [/call of duty|\bcod\b/i, 'Call of Duty'],
  [/battlefield/i, 'Battlefield'],
  [/need for speed/i, 'Need for Speed'],
  [/gran turismo/i, 'Gran Turismo'],
  [/forza/i, 'Forza'],
  [/civilization|\bciv\b/i, 'Civilization'],
  [/age of empires|\baoe\b/i, 'Age of Empires'],
  [/command (&|and) conquer/i, 'Command & Conquer'],
  [/total war/i, 'Total War'],
  [/xcom/i, 'XCOM'],
  [/worms/i, 'Worms'],
  [/lemmings/i, 'Lemmings'],
  [/tetris/i, 'Tetris'],
  [/pac-?man/i, 'Pac-Man'],
  [/donkey kong/i, 'Donkey Kong'],
  [/kirby/i, 'Kirby'],
  [/fire emblem/i, 'Fire Emblem'],
  [/dragon quest/i, 'Dragon Quest'],
  [/kingdom hearts/i, 'Kingdom Hearts'],
  [/tekken/i, 'Tekken'],
  [/\bdark souls\b|demon'?s souls|bloodborne|sekiro|elden ring|hollow knight|\bnioh\b|wo long|mortal shell|the surge|lies of p|\bremnant\b|blasphemous|salt and sanctuary|nine sols|wukong|lords of the fallen/i, 'Soulslike'],
  [/monkey island/i, 'Monkey Island'],
  [/king'?s quest/i, "King's Quest"],
  [/leisure suit larry/i, 'Leisure Suit Larry'],
  [/gabriel knight/i, 'Gabriel Knight'],
  [/wing commander/i, 'Wing Commander'],
  [/ultima/i, 'Ultima'],
  [/wizardry/i, 'Wizardry'],
  [/might and magic|heroes of might/i, 'Might and Magic'],
  [/tony hawk/i, 'Tony Hawk'],
]

/** Explicit franchise first, else title rules, else null. */
export function franchiseOf(g: GameEntry): string | null {
  if (g.franchise) return g.franchise
  for (const [re, name] of FRANCHISE_RULES) {
    if (re.test(g.title)) return name
  }
  return null
}

/** Reported units sold for a game, if a published figure was joined. */
export function salesFor(id: string): { units: number; source: string } | null {
  return SALES[id] ?? null
}

/** Approximate display ("≈15M copies"): figures are lower bounds with no
 *  as-of date, so never print false precision. */
export function formatSales(units: number): string {
  if (units >= 1_000_000) {
    const m = units / 1_000_000
    return `≈${Number.isInteger(m) ? String(m) : m.toFixed(1)}M copies`
  }
  if (units >= 1_000) {
    const k = units / 1_000
    return `≈${Number.isInteger(k) ? String(k) : k.toFixed(1)}k copies`
  }
  return `≈${units} copies`
}

/** Hand/custom entries default to popular; auto entries carry the vote flag. */
export function isPopular(g: GameEntry): boolean {
  return g.popular ?? true
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Pre-formatted round summary to paste into Discord. */
export function discordRoundText(solved: number, totalGames: number, points: number, hardest?: string): string {
  const base = window.location.origin + window.location.pathname
  return (
    `🎮 **Guess the Game** — round result: **${solved}/${totalGames}** solved, **${points} pts**!` +
    (hardest ? ` Toughest: **${hardest}**.` : '') +
    ` Start your own round: ${base}`
  )
}

/** Pre-formatted text the player can paste into Discord after solving. */
export function discordResultText(game: GameEntry, levelIdx: number, points: number, pool?: SharePool | null, shot?: number | null): string {
  const lvl = LEVELS[levelIdx]
  return (
    `🎮 **Guess the Game** — I guessed **${game.title} (${game.year})** ` +
    `at **${levelLabel(lvl)}** for **${points} pts**! ` +
    `Can you beat me? ${shareLink(game.id, pool, shot)}`
  )
}

/** Mid-game challenge text: current level and worth, but never the title. */
export function discordChallengeText(game: GameEntry, levelIdx: number, points: number, pool?: SharePool | null, shot?: number | null): string {
  const lvl = LEVELS[levelIdx]
  return (
    `🎮 **Guess the Game** — I'm stuck at **${levelLabel(lvl)}** ` +
    `(worth **${points} pts**), can you beat me? ${shareLink(game.id, pool, shot)}`
  )
}

const SCORE_KEY = 'gameguesser.totalScore'
const SOLVED_KEY = 'gameguesser.solvedCount'
const SEEN_KEY = 'gameguesser.seenGames'

/** Persisted play history (solved or gave up): reloads don't wipe it, so
 *  peeking at a solution and replaying at 16 wide scores a capped repeat. */
export function loadSeen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export function markSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...loadSeen(), [id]: true }))
  } catch {
    // ignore
  }
}

export function loadScore(): { total: number; solved: number } {
  try {
    return {
      total: Number(localStorage.getItem(SCORE_KEY) ?? 0) || 0,
      solved: Number(localStorage.getItem(SOLVED_KEY) ?? 0) || 0,
    }
  } catch {
    return { total: 0, solved: 0 }
  }
}

export function saveScore(total: number, solved: number): void {
  try {
    localStorage.setItem(SCORE_KEY, String(total))
    localStorage.setItem(SOLVED_KEY, String(solved))
  } catch {
    // private mode etc. — ignore
  }
}

/**
 * Amazon affiliate tag (e.g. "mygameblog-21"). Empty = plain search links.
 * When set, buy links carry &tag= — which legally requires ad disclosure
 * (in Germany: als Werbung kennzeichnen). See docs/OPERATIONS.md §9.
 */
export const AFFILIATE_TAG = ''

export interface GameLink {
  label: string
  url: string
  sponsored: boolean
}

/** External links for the result info card. Sponsored only when a tag is set. */
export function buyLinks(game: GameEntry): GameLink[] {
  const q = encodeURIComponent(game.title)
  const links: GameLink[] = [
    { label: 'MobyGames', url: `https://www.mobygames.com/search/?q=${q}`, sponsored: false },
  ]
  const amazon = `https://www.amazon.de/s?k=${q}${AFFILIATE_TAG ? `&tag=${AFFILIATE_TAG}` : ''}`
  links.unshift({ label: 'Amazon', url: amazon, sponsored: AFFILIATE_TAG !== '' })
  return links
}

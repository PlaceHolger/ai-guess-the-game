import { GAMES, type GameEntry } from '../data/games'

export interface PixelLevel {
  /** grid size, 0 = full resolution */
  size: number
  points: number
}

// 4x4 -> 8x8 -> 16x16 -> 32x32 -> 64x64 -> 96x96 -> full. Fewer points per reveal.
export const LEVELS: PixelLevel[] = [
  { size: 4, points: 1000 },
  { size: 8, points: 500 },
  { size: 16, points: 250 },
  { size: 32, points: 125 },
  { size: 64, points: 60 },
  { size: 96, points: 40 },
  { size: 0, points: 20 },
]

export function levelLabel(level: PixelLevel): string {
  return level.size === 0 ? 'Full' : `${level.size}×${level.size}`
}

export function pointsForLevel(idx: number): number {
  return LEVELS[Math.min(idx, LEVELS.length - 1)].points
}

export function randomGame(excludeId?: string): GameEntry {
  return randomFrom(GAMES, excludeId)
}

/** Random entry from a filtered pool (e.g. active category filters). */
export function randomFrom(pool: GameEntry[], excludeId?: string): GameEntry {
  const list = excludeId && pool.length > 1 ? pool.filter((g) => g.id !== excludeId) : pool
  return list[Math.floor(Math.random() * list.length)]
}

/** Shareable link that opens exactly one level. */
export function shareLink(gameId: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('game', gameId)
  return url.toString()
}

/** All usable shots for a game: primary first, then review alternates. */
export function shotsFor(game: GameEntry): string[] {
  return [game.screenshot, ...(game.altScreenshots ?? [])]
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
  [/\bsouls\b|bloodborne|sekiro|elden ring|demon'?s souls/i, 'Souls'],
  [/monkey island/i, 'Monkey Island'],
  [/king'?s quest/i, "King's Quest"],
  [/leisure suit larry/i, 'Leisure Suit Larry'],
  [/gabriel knight/i, 'Gabriel Knight'],
  [/wing commander/i, 'Wing Commander'],
  [/ultima/i, 'Ultima'],
  [/wizardry/i, 'Wizardry'],
  [/might and magic|heroes of might/i, 'Might and Magic'],
  [/tony hawk/i, 'Tony Hawk'],
  [/need for speed/i, 'Need for Speed'],
]

/** Explicit franchise first, else title rules, else null. */
export function franchiseOf(g: GameEntry): string | null {
  if (g.franchise) return g.franchise
  for (const [re, name] of FRANCHISE_RULES) {
    if (re.test(g.title)) return name
  }
  return null
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
export function discordResultText(game: GameEntry, levelIdx: number, points: number): string {
  const lvl = LEVELS[levelIdx]
  return (
    `🎮 **Guess the Game** — I guessed **${game.title} (${game.year})** ` +
    `at **${levelLabel(lvl)}** for **${points} pts**! ` +
    `Can you beat me? ${shareLink(game.id)}`
  )
}

const SCORE_KEY = 'gameguesser.totalScore'
const SOLVED_KEY = 'gameguesser.solvedCount'

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

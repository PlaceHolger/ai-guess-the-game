// Hand-curated core pool lives in games.tsv (human-editable). It is compiled
// to games.hand.ts by npm run data:build (auto-run before dev/build).
// Bulk entries (importer) and custom entries (add-custom) merge below.
import { HAND_GAMES } from './games.hand'
import { AUTO_GAMES } from './games.auto'
import { CUSTOM_GAMES } from './games.custom'

export interface GameEntry {
  /** stable id, also used in ?game=<id> share links and screenshot filename */
  id: string
  title: string
  year: number
  /** main genre, shown as info and usable as a filter */
  genre: string
  publisher: string
  developer: string
  /** headline/original platforms (up to 3), usable as a filter */
  platforms: string[]
  /** IGDB id for bulk-imported entries (dedup + traceability) */
  igdbId?: number
  /** accepted alternative answers, all matched fuzzily (e.g. "gta 5" for "Grand Theft Auto V") */
  aliases: string[]
  /** IGDB search query; optional (custom entries may skip it — then no IGDB fetching) */
  igdbQuery?: string
  /** extra screenshots of the same game (review alternates); rotate per player */
  altScreenshots?: string[]
  /** mainstream pick? default true (hand list curated); auto set by votes */
  popular?: boolean
  /** series, e.g. "Star Wars" — explicit, else derived from title rules */
  franchise?: string
  /** engine, e.g. "Unreal Engine" (IGDB data where available) */
  engine?: string
  /** Metacritic score 0-100 when known (RAWG backfill, see docs) */
  metacritic?: number
  /** canonical IGDB CDN shot (+ alts): hotlinked at runtime, no re-hosting */
  remote?: string
  remoteAlts?: string[]
  /** relative path under screenshots/<year>/, e.g. "screenshots/2022/elden-ring.jpg" */
  screenshot: string
}

// Large curated pool (hand TSV + bulk import + custom additions).
// Titles/years/publishers/platforms are facts; screenshots are NOT bundled (fetch via IGDB script).
export const GAMES: GameEntry[] = [...HAND_GAMES, ...AUTO_GAMES, ...CUSTOM_GAMES]

export function getGame(id: string | null): GameEntry | undefined {
  if (!id) return undefined
  return GAMES.find((g) => g.id === id)
}

// Fuzzy answer matching: accepts "Final Fantasy" for "Final Fantasy VII",
// typos, aliases ("gta 5" -> "Grand Theft Auto V"), missing subtitles, etc.
import type { GameEntry } from '../data/games'

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics (Pokémon -> pokemon)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ') // drop punctuation (: - ' . / etc.)
    .replace(/\s+/g, ' ')
    .trim()
}

const STOPWORDS = new Set(['the', 'of', 'a', 'an'])

// Edition/packaging words are never load-bearing: neither required in the
// guess ("hitman" solves the GOTY edition) nor sufficient alone.
const EDITION_WORDS = new Set([
  'edition', 'goty', 'deluxe', 'definitive', 'remaster', 'remastered', 'hd',
  'collection', 'bundle', 'complete',
])

/**
 * Token-level containment: needle appears as a contiguous run inside hay.
 * Prefix flexibility applies ONLY when the needle is the player's guess
 * (typed prefix: "tetr" → "tetris"). A catalog candidate inside a longer
 * guess must match whole tokens — otherwise short alias "king" would match
 * guess word "kingdom" and every Zelda guess would fit King's Quest.
 * Numerals always match exactly, even as prefixes ("ii" ≠ "iii").
 */
export function tokenIncludes(hay: string[], needle: string[], guessIsNeedle: boolean): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      const n = needle[j]
      const h = hay[i + j]
      const last = j === needle.length - 1
      if (/^\d+$/.test(n) || /^\d+$/.test(h)) {
        if (n !== h) continue outer
      } else if (last ? !(guessIsNeedle ? h.startsWith(n) : h === n) : h !== n) {
        continue outer
      }
    }
    return true
  }
  return false
}

const ROMAN_NUMERALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8',
  ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15',
  xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20',
}

function normTokens(s: string): string[] {
  return tokens(s).map((t) => ROMAN_NUMERALS[t] ?? t)
}

/**
 * True when every numeral in the guess is covered by the other game's title
 * or aliases ("gothic 1" can't mean Gothic II). Non-numeral guesses pass.
 * A numeral equal to the game's release year also covers ("Doom (1993)"
 * may mean the 1993 Doom) — autocomplete picks carry their year.
 */
export function numeralsCovered(guess: string, other: GameEntry): boolean {
  const nums = tokens(guess).filter((t) => /^\d+$/.test(t) || ROMAN_NUMERALS[t])
  if (!nums.length) return true
  const oSet = new Set(normTokens(other.title))
  for (const a of other.aliases) {
    for (const t of normTokens(a)) oSet.add(t)
  }
  return nums.every((t) => {
    const n = ROMAN_NUMERALS[t] ?? t
    if (Number(n) === other.year) return true
    return oSet.has(n)
  })
}
export function isMoreSpecific(guess: string, gameTitle: string, otherTitle: string): boolean {
  const g = new Set(normTokens(guess).filter((t) => !STOPWORDS.has(t)))
  const a = new Set(normTokens(gameTitle))
  const b = new Set(normTokens(otherTitle))
  return [...g].some((t) => a.has(t) && !b.has(t))
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

function meaningful(t: string[]): string[] {
  return t.filter((w) => !STOPWORDS.has(w) && !EDITION_WORDS.has(w))
}

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const cur = dp[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost)
      prev = cur
    }
  }
  return dp[n]
}

export interface GuessResult {
  correct: boolean
  close: boolean
  matchedVia?: string
}

function typoThreshold(len: number): number {
  if (len <= 4) return 1
  if (len <= 8) return 2
  return Math.max(2, Math.floor(len * 0.18))
}

export function checkGuess(rawGuess: string, game: GameEntry): GuessResult {
  const guess = normalize(rawGuess)
  if (!guess || guess.length < 2) return { correct: false, close: false }
  // Single stopword ("the") is never an answer.
  const guessTokens = tokens(guess)
  const guessMeaningful = meaningful(guessTokens)
  if (guessMeaningful.length === 0) return { correct: false, close: false }

  const candidates = [game.title, ...game.aliases]
  let close = false

  for (const cand of candidates) {
    const c = normalize(cand)
    if (!c) continue
    if (guess === c) return { correct: true, close: true, matchedVia: cand }

    // Containment rule ("final fantasy" in "final fantasy vii", "tetr" in
    // "tetris"): token-aware, so numerals can't straddle ("ii" ≠ "iii").
    const minLen = Math.min(guess.length, c.length)
    if (minLen >= 4) {
      const gt = normTokens(guess)
      const ct = normTokens(c)
      if (tokenIncludes(ct, gt, true) || tokenIncludes(gt, ct, false)) {
        return { correct: true, close: true, matchedVia: cand }
      }
    }

    // Token-subset rule: every guessed word appears in the title. Needs
    // substance — single 2–3 letter tokens ("ii") match far too widely.
    const candTokens = tokens(c)
    const candMeaningful = meaningful(candTokens)
    const hasSubstance = guessTokens.length >= 2 || guess.length >= 4
    const guessInCand = hasSubstance && guessMeaningful.every((t) => candTokens.includes(t))
    if (guessInCand) return { correct: true, close: true, matchedVia: cand }
    const candInGuess = candMeaningful.length > 0 && candMeaningful.every((t) => guessTokens.includes(t))
    if (candInGuess) return { correct: true, close: true, matchedVia: cand }

    // Typo tolerance, judged per candidate: a short alias ("rtl") must not
    // inherit the generous threshold of the long title ("gothic" is just
    // wrong for Risen 3, not close). Candidates under 4 chars ("elma")
    // only count on exact/substring/token rules — never on typos, where
    // they magnetize unrelated guesses ("zelda" is 2 edits from "elma").
    // Numerals decide identity ("gothic 4" is Arcania, never Gothic 3):
    // when both sides carry numerals and they differ, typos don't solve.
    if (c.length < 4) continue
    const d = levenshtein(guess, c)
    const t = typoThreshold(Math.max(guess.length, c.length))
    if (d <= t) {
      const numSet = (s: string) => new Set(normTokens(s).filter((x) => /^\d+$/.test(x)))
      const gn = numSet(guess)
      const cn = numSet(c)
      const sameNumerals =
        gn.size === 0 ||
        cn.size === 0 ||
        (gn.size === cn.size && [...gn].every((x) => cn.has(x)))
      if (sameNumerals) {
        return { correct: true, close: true, matchedVia: cand }
      }
    }
    if (d <= t + 2) close = true
  }

  return { correct: false, close }
}

/** Title mask for hints: letters/digits become _, structure stays visible. */
export function titleMask(title: string): string {
  return title.replace(/[a-zA-Z0-9]/g, '_').replace(/[à-öø-ÿĀ-ž]/g, '_')
}

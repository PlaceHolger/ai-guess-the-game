import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PixelCanvas from './components/PixelCanvas'
import GuessSuggestions from './components/GuessSuggestions'
import GuessForm from './components/GuessForm'
import { GAMES, getGame } from './data/games'
import { checkGuess, normalize, numeralsCovered, titleMask, tokenIncludes } from './lib/fuzzy'
import {
  LEVELS,
  AFFILIATE_TAG,
  buyLinks,
  discordResultText,
  discordChallengeText,
  discordRoundText,
  earnedPoints,
  findSharedGame,
  findSharedRound,
  franchiseOf,
  gridLabel,
  isGerman,
  isPopular,
  levelLabel,
  loadScore,
  loadSeen,
  markSeen,
  parseSharedPool,
  platformHit,
  preferFresh,
  randomFrom,
  randomGame,
  roundLink,
  saveScore,
  shareLink,
  SharedPoolPatch,
  shotsFor,
  RARE_PLATFORM_COUNT,
  YEAR_MIN,
  YEAR_MAX,
} from './lib/game'
import type { GameEntry } from './data/games'

const GENRES = [...new Set(GAMES.map((g) => g.genre))].sort()
const PUBLISHERS = [...new Set(GAMES.map((g) => g.publisher))].sort()
const PLATFORM_COUNTS = new Map<string, number>()
for (const g of GAMES) {
  for (const p of g.platforms) PLATFORM_COUNTS.set(p, (PLATFORM_COUNTS.get(p) ?? 0) + 1)
}
const RARE_PLATFORMS = [...PLATFORM_COUNTS].filter(([, n]) => n < RARE_PLATFORM_COUNT).map(([p]) => p).sort()
const PLATFORM_OPTIONS = [
  ...[...PLATFORM_COUNTS].filter(([, n]) => n >= RARE_PLATFORM_COUNT).map(([p]) => p).sort(),
  'Others',
]
const DEVELOPERS = [...new Set(GAMES.map((g) => g.developer))].sort()
const FRANCHISES = [...new Set(GAMES.map(franchiseOf).filter((f): f is string => f !== null))].sort()
const GENRE_OPTIONS = ['RPG (all)', 'Shooter (all)', ...GENRES]
const ROUND_SIZE = 10

interface RoundResult {
  solved: boolean
  points: number
  level: string
  tries: number
}

interface CustomList {
  name: string
  ids: string[]
}

const DECADES: Array<[string, number, number]> = [
  ['All', YEAR_MIN, YEAR_MAX],
  ['80s', 1980, 1989],
  ['90s', 1990, 1999],
  ['00s', 2000, 2009],
  ['10s', 2010, 2019],
  ['20s', 2020, YEAR_MAX],
]

function genreMatches(gameGenre: string, selected: string[]): boolean {  if (selected.length === 0) return true
  return selected.some((s) => {
    if (s === 'RPG (all)') return /rpg|role-playing/i.test(gameGenre)
    if (s === 'Shooter (all)') return /shooter/i.test(gameGenre)
    return gameGenre === s
  })
}

interface Filters {
  genres: string[]
  publishers: string[]
  platforms: string[]
  developers: string[]
  franchises: string[]
  showNiche: boolean
  ymin: number
  ymax: number
}

const DEFAULT_FILTERS: Filters = {
  genres: [], publishers: [], platforms: [], developers: [],
  franchises: [], showNiche: false, ymin: YEAR_MIN, ymax: YEAR_MAX,
}

interface PackageDef {
  label: string
  patch?: Partial<Filters>
  test?: (g: GameEntry) => boolean
}

// Themed packs: presets over the same filters (shareable, round-ready).
// Niche titles live here rather than in the default pool.
const PACKAGES: PackageDef[] = [
  { label: 'Star Wars', patch: { franchises: ['Star Wars'] } },
  { label: 'Pokémon', patch: { franchises: ['Pokémon'] } },
  { label: 'Mario', patch: { franchises: ['Mario'] } },
  { label: 'Zelda', patch: { franchises: ['Zelda'] } },
  { label: 'Soulslikes', patch: { franchises: ['Soulslike'] } },
  { label: 'N64', patch: { platforms: ['N64'] } },
  { label: 'SNES', patch: { platforms: ['SNES'] } },
  { label: 'DOS classics', patch: { platforms: ['DOS'] } },
  { label: 'Sierra', patch: { publishers: ['Sierra'] } },
  { label: 'id Software', patch: { developers: ['id Software'] } },
  { label: 'Blizzard', patch: { publishers: ['Blizzard Entertainment'] } },
  { label: 'Nintendo 90s', patch: { publishers: ['Nintendo'], ymin: 1990, ymax: 1999 } },
  { label: 'Made in Germany', test: (g) => isGerman(g) },
  { label: 'CryEngine', test: (g) => g.engine === 'CryEngine' },
  { label: 'Unity', test: (g) => g.engine === 'Unity' },
  { label: 'Unreal', test: (g) => (g.engine ?? '').includes('Unreal') },
  { label: 'id Tech', test: (g) => (g.engine ?? '').includes('id Tech') },
]
const FILTER_KEY = 'gameguesser.filters'
const LISTS_KEY = 'gameguesser.lists'

function loadLists(): CustomList[] {
  try {
    const raw = localStorage.getItem(LISTS_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as CustomList[]
      return arr
        .filter((l) => l && typeof l.name === 'string' && Array.isArray(l.ids))
        .map((l) => ({ name: l.name, ids: l.ids.filter((id) => typeof id === 'string' && getGame(id)) }))
        .filter((l) => l.name.length > 0)
    }
  } catch {
    // ignore
  }
  return []
}

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>
      // migrate legacy single-select strings (or 'All') to arrays
      const arr = (v: unknown): string[] => {
        if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
        if (typeof v === 'string' && v !== 'All') return [v]
        return []
      }
      return {
        ...DEFAULT_FILTERS,
        ...saved,
        genres: arr(saved.genre ?? saved.genres),
        publishers: arr(saved.publisher ?? saved.publishers),
        platforms: arr(saved.platform ?? saved.platforms),
        developers: arr(saved.developer ?? saved.developers),
        franchises: arr(saved.franchise ?? saved.franchises),
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_FILTERS
}

/** Pool context from a share link (?game= must be present). Returns the
 *  package (validated), a filter patch, and a banner label — or null when
 *  the link carries no pool context (plain level links). */
function sharedPoolFromUrl(): SharedPoolPatch | null {
  const labels = PACKAGES.map((p) => p.label)
  return parseSharedPool(new URLSearchParams(window.location.search), labels)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fallback for non-secure contexts
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export default function App() {
  const [initialSharedRound] = useState(() => {
    const sp = new URLSearchParams(window.location.search)
    const r = sp.get('round')
    if (!r) return null
    return findSharedRound(GAMES, r, Number(sp.get('i')) || 0)
  })
  const [gameId, setGameId] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('game')
    return (
      (fromUrl && findSharedGame(GAMES, fromUrl)?.id) ??
      initialSharedRound?.ids[initialSharedRound.pos] ??
      randomGame().id
    )
  })
  const [levelIdx, setLevelIdx] = useState(0)
  const [maxLevel, setMaxLevel] = useState(0)
  const [attempts, setAttempts] = useState(0)
  const [wrongs, setWrongs] = useState(0)
  const [hintStage, setHintStage] = useState(0)
  const [solved, setSolved] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // increments on every non-solving submit: GuessForm shakes the button
  const [shakeTick, setShakeTick] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [{ total, solved: solvedCount }, setScore] = useState(loadScore)
  // Shared pool (?pkg=&g=&… on a ?game= link): applied once on load so the
  // recipient's "next random" stays in the sender's universe. Own filters
  // are snapshotted for the restore button.
  const [initialSharedPool] = useState(() => sharedPoolFromUrl())
  const [prevFilters] = useState<Filters | null>(() => (initialSharedPool ? loadFilters() : null))
  const [filters, setFilters] = useState<Filters>(() => {
    if (!initialSharedPool) return loadFilters()
    const base = { ...DEFAULT_FILTERS }
    if (initialSharedPool.pkg) {
      Object.assign(base, PACKAGES.find((p) => p.label === initialSharedPool.pkg)?.patch)
    }
    return { ...base, ...initialSharedPool.patch }
  })
  const [activePackage, setActivePackage] = useState<string | null>(() => initialSharedPool?.pkg ?? null)
  const [sharedPoolLabel, setSharedPoolLabel] = useState<string | null>(() => initialSharedPool?.label ?? null)
  const [initialSharedId] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('game')
    return (fromUrl && findSharedGame(GAMES, fromUrl)?.id) ?? null
  })
  const [roundQueue, setRoundQueue] = useState<string[] | null>(() => initialSharedRound?.ids ?? null)
  const [roundResults, setRoundResults] = useState<Record<string, RoundResult>>({})
  const [showSummary, setShowSummary] = useState(false)
  // Custom curated lists (own state + localStorage); rounds from a list keep
  // its order and can be replayed from the summary.
  const [lists, setLists] = useState<CustomList[]>(loadLists)
  const [roundListName, setRoundListName] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [editingList, setEditingList] = useState<string | null>(null)
  const [addQuery, setAddQuery] = useState('')
  // Persisted history snapshot: solving an already-seen game scores capped.
  const seenBeforeRef = useRef<Set<string> | null>(null)
  if (seenBeforeRef.current === null) {
    seenBeforeRef.current = new Set(Object.keys(loadSeen()))
  }
  // setup screen (packages + filters) vs play screen (game only)
  const [screen, setScreen] = useState<'setup' | 'play'>('play')
  // per-facet search boxes (500+ publishers/developers need filtering)
  const [facetQuery, setFacetQuery] = useState<Record<FacetKey, string>>({
    genres: '', publishers: '', platforms: '', developers: '', franchises: '',
  })
  // spelling-aid browser removed (guess autocomplete covers it)
  // session no-repeat + random screenshot per appearance (shared links: primary)
  const seenRef = useRef<Set<string>>(new Set([gameId]))
  const [shotPos, setShotPos] = useState(0)
  const [shotAspect, setShotAspect] = useState<number | null>(null)
  // Actually displayed screenshot per game (follows rotation fallthrough).
  const shotHistRef = useRef(new Map<string, number>())
  const viewedShot = (id: string): number | null => shotHistRef.current.get(id) ?? null
  const sharedShotsRef = useRef(new Map<string, number>())
  const sharedShotsInit = useRef(false)
  if (!sharedShotsInit.current) {
    sharedShotsInit.current = true
    const sp = new URLSearchParams(window.location.search)
    const g = sp.get('game')
    const s = sp.get('s')
    if (g && s !== null && !Number.isNaN(Number(s))) {
      const id = findSharedGame(GAMES, g)?.id
      if (id) sharedShotsRef.current.set(id, Math.max(0, Number(s)))
    }
    const r = sp.get('round')
    if (r) {
      const parsed = findSharedRound(GAMES, r, Number(sp.get('i')) || 0)
      parsed?.ids.forEach((id, k) => {
        const sh = parsed.shots[k]
        if (sh !== null && sh !== undefined) sharedShotsRef.current.set(id, sh)
      })
    }
  }

  const game = useMemo(() => getGame(gameId) ?? GAMES[0], [gameId])
  // Stable screenshot list per game: shotsFor builds a new array every
  // call, and a fresh identity re-ran the canvas load effect on each
  // keystroke (shared image handlers + reset loading timer each time).
  const shots = useMemo(() => shotsFor(game), [game])
  const filtered = useMemo(
    () =>
      GAMES.filter(
        (g) =>
          genreMatches(g.genre, filters.genres) &&
          (filters.publishers.length === 0 || filters.publishers.includes(g.publisher)) &&
          (filters.platforms.length === 0 || platformHit(g.platforms, filters.platforms, RARE_PLATFORMS)) &&
          (filters.developers.length === 0 || filters.developers.includes(g.developer)) &&
          (filters.franchises.length === 0 || filters.franchises.includes(franchiseOf(g) ?? '')) &&
          (filters.showNiche || isPopular(g)) &&
          g.year >= filters.ymin &&
          g.year <= filters.ymax,
      ),
    [filters],
  )
  const activePkg = PACKAGES.find((p) => p.label === activePackage) ?? null
  const poolBase = useMemo(
    () => (activePkg?.test ? filtered.filter(activePkg.test) : filtered),
    [filtered, activePkg],
  )
  const pool = poolBase.length > 0 ? poolBase : filtered.length > 0 ? filtered : GAMES
  const roundSolved = Object.values(roundResults).filter((r) => r.solved).length
  const roundPoints = Object.values(roundResults).reduce((s, r) => s + r.points, 0)
  const hardestTitle: string | undefined = (() => {
    if (roundQueue === null) return undefined
    const rows = roundQueue
      .map((id) => ({ title: getGame(id)?.title ?? id, r: roundResults[id] }))
      .filter((x) => x.r)
    const unsolved = rows.find((x) => !x.r.solved)
    if (unsolved) return unsolved.title
    return [...rows].sort((a, b) => a.r.points - b.r.points)[0]?.title
  })()
  const isShared = useMemo(
    () => initialSharedId !== null && initialSharedId === game.id,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.id],
  )
  const isSharedRound =
    roundQueue !== null && initialSharedRound !== null && roundQueue === initialSharedRound.ids
  const finished = solved || gaveUp
  const points = earnedPoints(maxLevel, hintStage)
  const sharePool = { pkg: activePackage, ...filters }
  // Suggestions for the list editor (excludes games already on the list).
  const addSuggestions = useMemo(() => {
    const q = normalize(addQuery.trim())
    if (q.length < 2 || editingList === null) return [] as GameEntry[]
    const onList = new Set(lists.find((l) => l.name === editingList)?.ids ?? [])
    return GAMES.filter(
      (x) =>
        !onList.has(x.id) &&
        (normalize(x.title).includes(q) || x.aliases.some((a) => normalize(a).includes(q))),
    ).slice(0, 8)
  }, [addQuery, editingList, lists])
  // Guess input lives in GuessForm (own keystroke state); submit arrives
  // as a value so typing never re-renders the whole App.
  const pickGame = useCallback(
    (id: string) => {
      setGameId(id)
      setLevelIdx(0)
      setMaxLevel(0)
      setAttempts(0)
      setWrongs(0)
      setHintStage(0)
      setSolved(false)
      setGaveUp(false)
      setMessage(null)
      setShotAspect(null)
      seenRef.current.add(id)
      const shots = shotsFor(getGame(id) ?? GAMES[0])
      setShotPos(
        sharedShotsRef.current.get(id) ??
          (id === initialSharedId ? 0 : Math.floor(Math.random() * shots.length)),
      )
      const url = new URL(window.location.href)
      for (const k of ['game', 'pkg', 'g', 'pub', 'plat', 'dev', 'fr', 'niche', 'ymin', 'ymax', 'round', 'i', 's']) {
        url.searchParams.delete(k)
      }
      window.history.replaceState(null, '', url.toString())
    },
    [initialSharedId],
  )

  useEffect(() => {
    saveScore(total, solvedCount)
  }, [total, solvedCount])

  const updateFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setActivePackage(null)
  }, [])

  type FacetKey = 'genres' | 'publishers' | 'platforms' | 'developers' | 'franchises'
  const toggleFilter = useCallback((key: FacetKey, value: string) => {
    setFilters((f) => {
      const cur = f[key]
      return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
    setActivePackage(null)
  }, [])

  const pickPackage = useCallback((label: string) => {
    if (label === activePackage) {
      setActivePackage(null)
      return
    }
    const pkg = PACKAGES.find((p) => p.label === label)
    if (!pkg) return
    setFilters({ ...DEFAULT_FILTERS, ...pkg.patch })
    setActivePackage(label)
  }, [activePackage])

  useEffect(() => {
    try {
      localStorage.setItem(LISTS_KEY, JSON.stringify(lists))
    } catch {
      // ignore
    }
  }, [lists])

  const startRound = useCallback(() => {
    const n = Math.min(ROUND_SIZE, pool.length)
    if (n === 0) return
    const ids = preferFresh(pool, seenRef.current, seenBeforeRef.current ?? new Set())
      .slice(0, n)
      .map((g) => g.id)
    setRoundQueue(ids)
    setRoundResults({})
    setShowSummary(false)
    setRoundListName(null)
    setScreen('play')
    pickGame(ids[0])
  }, [pool, pickGame])

  const playList = useCallback((list: CustomList) => {
    if (list.ids.length === 0) return
    setRoundQueue([...list.ids])
    setRoundResults({})
    setShowSummary(false)
    setRoundListName(list.name)
    setScreen('play')
    pickGame(list.ids[0])
  }, [pickGame])

  const replayList = useCallback(() => {
    if (roundQueue === null) return
    setRoundResults({})
    setShowSummary(false)
    pickGame(roundQueue[0])
  }, [roundQueue, pickGame])

  const createList = useCallback(() => {
    const name = newListName.trim()
    if (!name) return
    setLists((ls) => (ls.some((l) => l.name === name) ? ls : [...ls, { name, ids: [] }]))
    setNewListName('')
    setEditingList(name)
    setAddQuery('')
  }, [newListName])

  const deleteList = useCallback((name: string) => {
    setLists((ls) => ls.filter((l) => l.name !== name))
    setEditingList((e) => (e === name ? null : e))
  }, [])

  const addToList = useCallback((display: string) => {
    const m = display.match(/^(.*) \((\d{4})\)$/)
    const g = m
      ? GAMES.find((x) => x.title === m[1] && x.year === Number(m[2]))
      : GAMES.find((x) => x.title === display)
    if (!g) return
    setLists((ls) =>
      ls.map((l) => (l.name === editingList && !l.ids.includes(g.id) ? { ...l, ids: [...l.ids, g.id] } : l)),
    )
  }, [editingList])

  const removeFromList = useCallback((name: string, id: string) => {
    setLists((ls) => ls.map((l) => (l.name === name ? { ...l, ids: l.ids.filter((x) => x !== id) } : l)))
  }, [])

  const shareList = useCallback(
    async (list: CustomList) => {
      if (!list.ids.length) return
      const ok = await copyText(roundLink(list.ids, 0, list.ids.map(viewedShot)))
      flash(ok ? 'List link copied — same games, same order!' : 'Copy failed')
    },
    [],
  )

  // free play: prefer games not yet seen (this session, then past ones)
  const nextFreePick = useCallback((excludeId?: string) => {
    const persisted = seenBeforeRef.current ?? new Set<string>()
    const fresh = pool.filter(
      (g) => g.id !== excludeId && !seenRef.current.has(g.id) && !persisted.has(g.id),
    )
    if (fresh.length) return randomFrom(fresh).id
    const unsess = pool.filter((g) => g.id !== excludeId && !seenRef.current.has(g.id))
    if (unsess.length) return randomFrom(unsess).id
    seenRef.current.clear()
    return randomFrom(pool, excludeId).id
  }, [pool])

  const exitRound = useCallback(() => {
    setRoundQueue(null)
    setRoundResults({})
    setShowSummary(false)
    setRoundListName(null)
  }, [])

  const giveUp = useCallback(() => {
    setGaveUp(true)
    setLevelIdx(LEVELS.length - 1)
    setMessage(null)
    if (roundQueue !== null) {
      setRoundResults((r) => ({ ...r, [game.id]: { solved: false, points: 0, level: levelLabel(LEVELS[maxLevel]), tries: attempts } }))
    }
    markSeen(game.id)
    seenBeforeRef.current?.add(game.id)
  }, [roundQueue, game.id, maxLevel, attempts])

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters))
    } catch {
      // ignore
    }
  }, [filters])

  // If the filters exclude the current game, jump to one that matches —
  // unless the current game is a shared challenge link, or a round is running.
  useEffect(() => {
    if (gameId === initialSharedId || roundQueue !== null) return
    if (!pool.some((g) => g.id === gameId)) {
      pickGame(randomFrom(pool).id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, roundQueue])

  const submitGuess = useCallback((value: string) => {
    if (finished || !value.trim()) return
    const res = checkGuess(value, game)
    if (res.correct) {
      // Exact title/alias match wins outright when unique ("gothic").
      // Otherwise: if this is the ONLY game the guess fits — however
      // partial ("resident evil biohazard" only fits RE7) — it solves.
      // Several fits → name it precisely ("🔎 Almost — …").
      const gnorm = normalize(value)
      // Exact title/alias match wins outright when unique ("gothic"). The
      // "Title (year)" form counts too — autocomplete inserts it on pick.
      const exactTitle = (g: GameEntry, n: string): boolean =>
        n === normalize(g.title) ||
        n === normalize(`${g.title} (${g.year})`) ||
        g.aliases.some((a) => normalize(a) === n)
      const exactHere = exactTitle(game, gnorm)
      const exactElsewhere =
        exactHere && GAMES.some((o) => o.id !== game.id && exactTitle(o, gnorm))
      if (exactHere && !exactElsewhere) {
        // unique exact: solve below
      } else {
        // Not uniquely exact: solve only as the single fit. Rivals must
        // also cover the guess's numerals ("doom 2016" can't mean Doom 1993).
        const others = GAMES.filter(
          (o) => o.id !== game.id && checkGuess(value, o).correct && numeralsCovered(value, o),
        )
        if (others.length > 0) {
          const names = [game, ...others].slice(0, 4).map((g) => g.title).join(' · ')
          setAttempts((a) => a + 1)
          setMessage(`🔎 Almost — your guess fits several games (${names}). Which one exactly?`)
          return
        }
      }
      setSolved(true)
      setLevelIdx(LEVELS.length - 1)
      const earned = earnedPoints(maxLevel, hintStage)
      const repeat = seenBeforeRef.current?.has(game.id) ?? false
      const pts = repeat ? Math.min(earned, 10) : earned
      const lvl = levelLabel(LEVELS[maxLevel])
      setScore((s) => ({ total: s.total + pts, solved: s.solved + 1 }))
      if (roundQueue !== null) {
        setRoundResults((r) => ({ ...r, [game.id]: { solved: true, points: pts, level: lvl, tries: attempts + 1 } }))
      }
      markSeen(game.id)
      seenBeforeRef.current?.add(game.id)
      setMessage(`✅ Correct! ${game.title} (${game.year}) — +${pts} pts at ${lvl}${hintStage > 0 ? ` (after ${hintStage} hint${hintStage > 1 ? 's' : ''})` : ''}${repeat ? ' (repeat — max 10 pts)' : ''}.`)
    } else {
      // Wrong (whatever the flavor): shake the Guess button for feedback.
      setShakeTick((t) => t + 1)
      // The guess fits one or more OTHER games: a single rival redirects
      // ("gothic 4" while Gothic 3 is shown means Arcania), several ask.
      // Rivals must cover the guess's numerals, same as in the solve path.
      const gnorm = normalize(value)
      const others = GAMES.filter(
        (o) => o.id !== game.id && checkGuess(value, o).correct && numeralsCovered(value, o),
      )
      if (others.length === 1) {
        const other = others[0]
        const fr = franchiseOf(other)
        const note =
          other.developer === game.developer
            ? ` — same developer (${game.developer})`
            : fr && fr === franchiseOf(game)
              ? ` — same ${fr} universe`
              : other.publisher === game.publisher
                ? ` — also ${game.publisher}`
                : ''
        setAttempts((a) => a + 1)
        // Always lead with the guess ("your guess … is not …"), then name
        // the game it actually is — never parrot an exact pick twice.
        const echo = value.trim()
        const namesIt =
          normalize(echo) === normalize(other.title) ||
          normalize(echo) === normalize(`${other.title} (${other.year})`)
        setMessage(
          namesIt
            ? `🎯 Your guess "${echo}" is not the correct answer for this level${note}!`
            : `🎯 Your guess "${echo}" is ${other.title} (${other.year})${note} — not the correct answer for this level!`,
        )
        return
      }
      if (others.length > 1) {
        const names = others.slice(0, 4).map((x) => x.title).join(' · ')
        setAttempts((a) => a + 1)
        setMessage(`❌ Nope — "${value.trim()}" could mean several games (${names}), but none of them is the correct answer for this level!`)
        return
      }
      // Naming the credits ("daedalic" for a Daedalic game): confirm the
      // developer / publisher without giving away the game.
      const guessTokens = gnorm.split(' ').filter(Boolean)
      const known = (s: string) => s && !/^unknown$/i.test(s)
      const creditHit =
        known(game.developer) &&
        tokenIncludes(normalize(game.developer).split(' ').filter(Boolean), guessTokens, true)
          ? `developer (${game.developer})`
          : known(game.publisher) &&
              tokenIncludes(normalize(game.publisher).split(' ').filter(Boolean), guessTokens, true)
            ? `publisher (${game.publisher})`
            : null
      if (creditHit) {
        setAttempts((a) => a + 1)
        setMessage(`🔍 Close — right ${creditHit}, but which game?`)
        return
      }
      if (res.close) {
        setAttempts((a) => a + 1)
        setMessage('🔥 Close! Try again — check spelling / full title.')
      } else {
        // outright wrong: count it, and every 2nd wrong guess reveals more
        // pixels automatically (anti-stall; the points drop covers the help)
        const w = wrongs + 1
        setWrongs(w)
        setAttempts((a) => a + 1)
        if (w >= 2 && levelIdx < LEVELS.length - 1) {
          const n = Math.min(levelIdx + 1, LEVELS.length - 1)
          setLevelIdx(n)
          setMaxLevel((m) => Math.max(m, n))
          setWrongs(0)
          setMessage('❌ Nope — revealing more pixels for you.')
        } else {
          setMessage('❌ Nope, try again or reveal more pixels (fewer points).')
        }
      }
    }
  }, [finished, game, maxLevel, roundQueue, wrongs, levelIdx, hintStage, attempts])

  const takeHint = useCallback(() => {
    if (finished || hintStage >= 2) return
    setHintStage((s) => s + 1)
    setMessage(null)
  }, [finished, hintStage])

  const revealMore = useCallback(() => {
    if (finished) return
    setLevelIdx((i) => {
      const n = Math.min(i + 1, LEVELS.length - 1)
      setMaxLevel((m) => Math.max(m, n))
      return n
    })
    setMessage(null)
  }, [finished])

  const flash = (t: string) => {
    setToast(t)
    window.setTimeout(() => setToast(null), 2200)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>🎮 Guess the Game</h1>
          <p className="sub">Guess the game from pixels. Start at 16 wide — reveal more, score less.</p>
        </div>
        <div className="score">
          <div><strong>{total}</strong> pts</div>
          <div className="muted">{solvedCount} solved</div>
          <button onClick={() => setScreen('setup')}>⚙ New game</button>
        </div>
      </header>

      {isShared && (
        <div className="banner">
          🔗 Shared challenge — no spoilers, guess first, then forward it!
        </div>
      )}
      {sharedPoolLabel !== null && (
        <div className="banner">
          🎲 Shared pool: <strong>{sharedPoolLabel}</strong> — your filters were switched to match.{' '}
          {prevFilters !== null && (
            <button onClick={() => { setFilters(prevFilters); setActivePackage(null); setSharedPoolLabel(null) }}>Restore my filters</button>
          )}
        </div>
      )}

      {roundQueue !== null && !showSummary && (
        <div className="banner">
          🏁 {isSharedRound ? 'Shared round' : 'Round'} game {roundQueue.indexOf(gameId) + 1} of {roundQueue.length} · {roundPoints} pts so far{' '}
          <button onClick={exitRound}>Exit round</button>{' '}
          <button
            onClick={async () => {
              const ok = await copyText(
                roundLink(roundQueue, Math.max(0, roundQueue.indexOf(gameId)), roundQueue.map(viewedShot)),
              )
              flash(ok ? 'Round link copied — same levels, same shots, same order!' : 'Copy failed')
            }}
          >
            Copy round link
          </button>
        </div>
      )}

      <main className="card">
        {showSummary && roundQueue !== null ? (
          <div className="summary">
            <h2>🏁 Round over!</h2>
            <p><strong>{roundSolved}/{roundQueue.length}</strong> solved — <strong>{roundPoints} pts</strong></p>
            <div className="roundlist">
              {roundQueue.map((id, i) => {
                const g = getGame(id)
                if (!g) return null
                const r = roundResults[id]
                return (
                  <div key={`${id}-${i}`} className="roundrow">
                    <span>{r?.solved ? '✅' : '❌'} {g.title} <span className="muted">({g.year})</span></span>
                    <span className="muted">{r ? (r.solved ? `${r.points} pts @ ${r.level} · ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}` : `gave up (saw ${r.level}, ${r.tries} ${r.tries === 1 ? 'try' : 'tries'})`) : '—'}</span>
                    <button
                      onClick={async () => {
                        const ok = await copyText(shareLink(id, sharePool, viewedShot(id)))
                        flash(ok ? 'Challenge link copied — share it anywhere!' : 'Copy failed')
                      }}
                    >
                      Share this game
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="btnrow">
              <button
                className="primary"
                onClick={async () => {
                  const ok = await copyText(discordRoundText(roundSolved, roundQueue.length, roundPoints, hardestTitle))
                  flash(ok ? 'Round result copied — paste it anywhere!' : 'Copy failed')
                }}
              >
                Copy round result as text
              </button>
              <button onClick={roundListName ? replayList : startRound}>{roundListName ? `Replay ${roundListName}` : 'New round'}</button>
              <button onClick={() => { exitRound(); pickGame(nextFreePick()) }}>Free play</button>
              <button
                onClick={async () => {
                  const ok = await copyText(roundLink(roundQueue, Math.max(0, roundQueue.indexOf(gameId)), roundQueue.map(viewedShot)))
                  flash(ok ? 'Round link copied — same 10 levels, same order!' : 'Copy failed')
                }}
              >
                Copy round link
              </button>
            </div>
            <p className="muted">Send friends the round link — they play the same levels in order, then start their own round from the summary.</p>
          </div>
        ) : screen === 'setup' ? (
          <>
            <h2>⚙ New game</h2>
            <p className="muted">Packages and filters define the pool ({pool.length} / {GAMES.length} levels). Starting something new abandons a running round.</p>
            {roundQueue !== null && (
              <p className="message locknote">🔒 <strong>Locked:</strong> a round is running — packages, filters and lists stay as they are until it ends. Exit the round to change the pool.</p>
            )}
            <div className="btnrow">
              <button onClick={() => setScreen('play')}>← Back to game</button>
              {roundQueue !== null && (
                <button onClick={exitRound}>Exit round to unlock filters</button>
              )}
            </div>
        <div className="levels">
          {PACKAGES.map((p) => (
            <button
              key={p.label}
              className={`chip ${activePackage === p.label ? 'active' : ''}`}
              onClick={() => pickPackage(p.label)}
            >
              📦 {p.label}
            </button>
          ))}
        </div>
        <div className="filters">
          {([
            ['Genre', 'genres', GENRE_OPTIONS],
            ['Publisher', 'publishers', PUBLISHERS],
            ['Platform', 'platforms', PLATFORM_OPTIONS],
            ['Developer', 'developers', DEVELOPERS],
            ['Franchise', 'franchises', FRANCHISES],
          ] as Array<[string, FacetKey, string[]]>).map(([label, key, options]) => {
            const q = facetQuery[key].trim().toLowerCase()
            const sel = filters[key]
            const rest = options.filter((o) => !sel.includes(o) && (q === '' || o.toLowerCase().includes(q)))
            const visible = [...sel, ...rest]
            return (
            <details className="facet" key={key}>
              <summary>{label}{sel.length > 0 && ` (${sel.length})`}</summary>
              <div className="facetlist">
                {options.length > 10 && (
                  <input
                    placeholder={`Filter ${options.length}…`}
                    value={facetQuery[key]}
                    onChange={(e) => setFacetQuery((fq) => ({ ...fq, [key]: e.target.value }))}
                  />
                )}
                {visible.map((o) => (
                  <label key={o}>
                    <input
                      type="checkbox" checked={sel.includes(o)} disabled={roundQueue !== null}
                      onChange={() => toggleFilter(key, o)}
                    />{' '}
                    {o}
                  </label>
                ))}
                {visible.length === 0 && <span className="muted">No match.</span>}
              </div>
            </details>
            )
          })}
          <label title="Include homebrew and low-vote titles">
            <input
              type="checkbox" checked={filters.showNiche} disabled={roundQueue !== null}
              onChange={(e) => updateFilters({ showNiche: e.target.checked })}
            />{' '}
            niche picks
          </label>
          <div className="yearrange">
            <span className="yearlabels">From <strong>{filters.ymin}</strong> to <strong>{filters.ymax}</strong></span>
            <div className="dualslider">
              <div
                className="dualslider-fill"
                style={{
                  left: `${((filters.ymin - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%`,
                  right: `${100 - ((filters.ymax - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%`,
                }}
              />
              <input
                type="range" aria-label="From year"
                min={YEAR_MIN} max={YEAR_MAX} value={filters.ymin} disabled={roundQueue !== null}
                onChange={(e) => updateFilters({ ymin: Math.min(Number(e.target.value), filters.ymax) })}
              />
              <input
                type="range" aria-label="To year"
                min={YEAR_MIN} max={YEAR_MAX} value={filters.ymax} disabled={roundQueue !== null}
                onChange={(e) => updateFilters({ ymax: Math.max(Number(e.target.value), filters.ymin) })}
              />
            </div>
          </div>
          <button onClick={() => { setFilters(DEFAULT_FILTERS); setActivePackage(null) }} disabled={roundQueue !== null}>Reset</button>
          <span className="muted">{pool.length} / {GAMES.length} levels{activePackage ? ` · 📦 ${activePackage}` : ''}{roundQueue !== null ? ' · locked in round' : ''}</span>
        </div>
        <div className="levels">
          {DECADES.map(([label, lo, hi]) => (
            <button
              key={label}
              className={`chip ${filters.ymin === lo && filters.ymax === hi ? 'active' : ''}`}
              disabled={roundQueue !== null}
              onClick={() => updateFilters({ ymin: lo, ymax: hi })}
            >
              {label}
            </button>
          ))}
        </div>
        {poolBase.length === 0 && (
          <p className="message">No games match{activePackage ? ` this package (${activePackage})` : ' these filters'} — widen the years or pick another genre/publisher/platform/developer/franchise.</p>
        )}
        <div className="lists">
          <h3>My lists</h3>
          <p className="muted">Handpicked rounds for friends — played in order, shared with one link.</p>
          <div className="btnrow">
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="New list name…"
            />
            <button onClick={createList} disabled={newListName.trim() === ''}>Create list</button>
          </div>
          {lists.map((l) => (
            <div key={l.name} className="listrow">
              <strong>{l.name}</strong> <span className="muted">({l.ids.length} games)</span>{' '}
              <button className="primary" onClick={() => playList(l)} disabled={l.ids.length === 0}>Play</button>{' '}
              <button onClick={() => shareList(l)} disabled={l.ids.length === 0}>Share</button>{' '}
              <button onClick={() => setEditingList((e) => (e === l.name ? null : l.name))}>
                {editingList === l.name ? 'Done' : 'Edit'}
              </button>{' '}
              <button className="danger" onClick={() => deleteList(l.name)}>Delete</button>
              {editingList === l.name && (
                <>
                  <div className="gamelist">
                    {l.ids.map((id) => {
                      const gm = getGame(id)
                      if (!gm) return null
                      return (
                        <span key={id}>
                          {gm.title} ({gm.year}){' '}
                          <button onClick={() => removeFromList(l.name, id)}>x</button>
                        </span>
                      )
                    })}
                  </div>
                  <input
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    placeholder="Type to add a game…"
                  />
                  <GuessSuggestions suggestions={addSuggestions} onPick={addToList} />
                </>
              )}
            </div>
          ))}
        </div>
            <div className="btnrow">
              <button className="primary" onClick={startRound} disabled={pool.length === 0}>
                Start round ({Math.min(ROUND_SIZE, pool.length)})
              </button>
              <button onClick={() => { exitRound(); pickGame(nextFreePick()); setScreen('play') }}>
                Start free play
              </button>
            </div>
          </>
        ) : (
          <>
        <div className="levels">
          {LEVELS.map((lvl, i) => (
            <button
              key={lvl.size}
              className={`chip ${i === levelIdx ? 'active' : ''} ${i <= maxLevel ? 'seen' : ''}`}
              onClick={() => i <= maxLevel && setLevelIdx(i)}
              disabled={i > maxLevel}
              title={`${gridLabel(lvl.size, shotAspect)} — ${lvl.points} pts`}
            >
              {gridLabel(lvl.size, shotAspect)} · {lvl.points}
            </button>
          ))}
        </div>

        <div className={`shotwrap${solved ? ' solved' : ''}`}>
          <PixelCanvas key={`canvas-${game.id}`} srcs={shots} startAt={shotPos} resolution={LEVELS[levelIdx].size} seed={game.id} onShow={(idx) => shotHistRef.current.set(gameId, idx)} onAspect={setShotAspect} />
          {solved && <div className="correct-flash" aria-hidden="true">✓</div>}
        </div>
        <div className="meta">
          <span>Level: <strong>{gridLabel(LEVELS[levelIdx].size, shotAspect)}</strong></span>
          <span>Worth: <strong>{points} pts</strong></span>
          <span className="muted">Attempts: <span key={attempts} className="attempts-pop">{attempts}</span></span>
        </div>

        {!finished ? (
          <GuessForm
            key={`guess-${game.id}`}
            onSubmit={submitGuess}
            shakeKey={shakeTick}
            actions={
              <>
                <button type="button" onClick={revealMore} disabled={levelIdx >= LEVELS.length - 1}>
                  Reveal more (−pts)
                </button>
                <button type="button" onClick={takeHint} disabled={hintStage >= 2} title={hintStage === 0 ? 'Reveal the release year (halves points)' : 'Reveal the title shape (halves points again)'}>
                  {hintStage === 0 ? 'Hint: year (−50%)' : hintStage === 1 ? 'Hint: title (−50%)' : 'Hints used'}
                </button>
              </>
            }
          />
        ) : (
          <div className="result">
            {solved ? (
              <p>🎉 <strong>{game.title}</strong> ({game.year}) — solved at {levelLabel(LEVELS[maxLevel])}.</p>
            ) : (
              <p>It was <strong>{game.title}</strong> ({game.year}). No points this time.</p>
            )}
            <div className="gameinfo">
              <div><span className="muted">Genre</span> {game.genre}</div>
              <div><span className="muted">Publisher</span> {game.publisher} · <span className="muted">Developer</span> {game.developer}</div>
              <div><span className="muted">Platforms</span> {game.platforms.join(' · ')}</div>
              {game.metacritic !== undefined && (
                <div><span className="muted">Metacritic</span> <strong>{game.metacritic}</strong>/100</div>
              )}
              <div className="links">
                {buyLinks(game).map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                    {l.label}{l.sponsored ? ' (ad)' : ''}
                  </a>
                ))}
              </div>
            </div>
            <div className="btnrow">
              <button
                className="primary"
                onClick={async () => {
                  const ok = await copyText(shareLink(game.id, sharePool, viewedShot(game.id)))
                  flash(ok ? 'Challenge link copied — paste it anywhere!' : 'Copy failed')
                }}
              >
                Copy challenge link
              </button>
              {solved ? (
                <button
                  onClick={async () => {
                    const earned = earnedPoints(maxLevel, hintStage)
                    const ok = await copyText(discordResultText(game, maxLevel, earned, sharePool, viewedShot(game.id)))
                    flash(ok ? 'Result copied — paste it anywhere!' : 'Copy failed')
                  }}
                >
                  Copy result as text
                </button>
              ) : !finished && (
                <button
                  onClick={async () => {
                    const ok = await copyText(discordChallengeText(game, maxLevel, points, sharePool, viewedShot(game.id)))
                    flash(ok ? 'Challenge copied — paste it anywhere!' : 'Copy failed')
                  }}
                >
                  Copy challenge as text
                </button>
              )}
              {roundQueue !== null ? (
                roundQueue.indexOf(gameId) < roundQueue.length - 1 ? (
                  <button className="primary" onClick={() => pickGame(roundQueue[roundQueue.indexOf(gameId) + 1])}>
                    Next in round ({roundQueue.indexOf(gameId) + 2}/{roundQueue.length})
                  </button>
                ) : (
                  <button className="primary" onClick={() => setShowSummary(true)}>Round results →</button>
                )
              ) : (
                <button onClick={() => pickGame(nextFreePick(game.id))} disabled={pool.length < 2}>Next random</button>
              )}
            </div>
          </div>
        )}

        {hintStage >= 1 && !finished && (
          <p className="message">📅 Release year: <strong>{game.year}</strong>{hintStage >= 2 && (<> · 🔤 Title shape: <code>{titleMask(game.title)}</code></>)}</p>
        )}

        {message && <p className="message">{message}</p>}

        {!finished && (
          <div className="btnrow">
            <button
              onClick={async () => {
                const ok = await copyText(shareLink(game.id, sharePool, viewedShot(game.id)))
                flash(ok ? 'Challenge link copied — paste it anywhere!' : 'Copy failed')
              }}
            >
              Copy challenge link
            </button>
            <button className="danger" onClick={giveUp}>
              Give up & reveal
            </button>
            {roundQueue === null && (
              <button onClick={() => pickGame(nextFreePick(game.id))} disabled={pool.length < 2}>Skip</button>
            )}
          </div>
        )}

        <details className="how">
          <summary>How scoring & sharing works</summary>
          <ul>
            <li>Each level is one game. You start at <strong>4×4</strong> ({LEVELS[0].points} pts). Every reveal halves the points down to full image.</li>
            <li>Near answers count: <em>“gta 5”</em> solves Grand Theft Auto V, <em>“botw”</em> solves Breath of the Wild, typos included. Vague names fit several games — then you get asked which one exactly.</li>
            <li><strong>Hints:</strong> first hint reveals the release year, second the title shape. Each halves your points (min 10).</li>
            <li><strong>Rounds:</strong> set genre / publisher / platform / year filters, then “Start round” plays 10 random levels from that pool. The summary lets you share any single game and copy the round result as text.</li>
            <li><strong>Sharing:</strong> “Copy challenge link” copies a link like <code>?game=3fa9c1e</code> — level plus your current pool (package, years, filters), so a friend's “next random” stays in your universe. Paste it anywhere (Discord, chat, mail). Stuck mid-game? “Copy challenge as text” shares your current level without spoiling the title. After solving, “Copy result” gives you a message with your score to paste back so everyone can compare.</li>
          </ul>
        </details>

          </>
        )}
      </main>

      <footer className="muted small">
        Screenshots are fetched separately via IGDB (see README) and are © their publishers — used for guessing only.
        <details className="credits">
          <summary>Sources & credits</summary>
          <ul>
            <li>Screenshots & metadata via the <a href="https://www.igdb.com/" target="_blank" rel="noreferrer">IGDB API</a> (images © their publishers).</li>
            <li>Retro snaps via <a href="https://github.com/libretro-thumbnails" target="_blank" rel="noreferrer">libretro-thumbnails</a> (fan captures, © their publishers).</li>
            <li>Metacritic scores via the <a href="https://rawg.io/apidocs" target="_blank" rel="noreferrer">RAWG API</a>.</li>
            <li>Game data: hand-curated list plus IGDB. Guess matching is local fuzzy logic, no tracking.</li>
            {AFFILIATE_TAG !== '' && (
              <li>Links marked (ad) are affiliate links — the site earns a commission on qualifying purchases.</li>
            )}
          </ul>
        </details>
      </footer>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

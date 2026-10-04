import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PixelCanvas from './components/PixelCanvas'
import { GAMES, getGame } from './data/games'
import { checkGuess, normalize, numeralsCovered, titleMask } from './lib/fuzzy'
import {
  LEVELS,
  AFFILIATE_TAG,
  buyLinks,
  discordResultText,
  discordRoundText,
  franchiseOf,
  isGerman,
  isPopular,
  levelLabel,
  loadScore,
  pointsForLevel,
  randomFrom,
  randomGame,
  saveScore,
  shareLink,
  shotsFor,
  shuffle,
} from './lib/game'
import type { GameEntry } from './data/games'

const GENRES = [...new Set(GAMES.map((g) => g.genre))].sort()
const PUBLISHERS = [...new Set(GAMES.map((g) => g.publisher))].sort()
const PLATFORMS = [...new Set(GAMES.flatMap((g) => g.platforms))].sort()
const DEVELOPERS = [...new Set(GAMES.map((g) => g.developer))].sort()
const FRANCHISES = [...new Set(GAMES.map(franchiseOf).filter((f): f is string => f !== null))].sort()
const GENRE_OPTIONS = ['All', 'RPG (all)', 'Shooter (all)', ...GENRES]
const YEAR_MIN = 1970
const YEAR_MAX = 2026
const ROUND_SIZE = 10
const HINT_COST = 150

interface RoundResult {
  solved: boolean
  points: number
  level: string
}

const DECADES: Array<[string, number, number]> = [
  ['All', YEAR_MIN, YEAR_MAX],
  ['80s', 1980, 1989],
  ['90s', 1990, 1999],
  ['00s', 2000, 2009],
  ['10s', 2010, 2019],
  ['20s', 2020, YEAR_MAX],
]

function genreMatches(gameGenre: string, selected: string): boolean {
  if (selected === 'All') return true
  if (selected === 'RPG (all)') return /rpg|role-playing/i.test(gameGenre)
  if (selected === 'Shooter (all)') return /shooter/i.test(gameGenre)
  return gameGenre === selected
}

interface Filters {
  genre: string
  publisher: string
  platform: string
  developer: string
  franchise: string
  showNiche: boolean
  ymin: number
  ymax: number
}

const DEFAULT_FILTERS: Filters = {
  genre: 'All', publisher: 'All', platform: 'All', developer: 'All',
  franchise: 'All', showNiche: false, ymin: YEAR_MIN, ymax: YEAR_MAX,
}

interface PackageDef {
  label: string
  patch?: Partial<Filters>
  test?: (g: GameEntry) => boolean
}

// Themed packs: presets over the same filters (shareable, round-ready).
// Niche titles live here rather than in the default pool.
const PACKAGES: PackageDef[] = [
  { label: 'Star Wars', patch: { franchise: 'Star Wars' } },
  { label: 'Pokémon', patch: { franchise: 'Pokémon' } },
  { label: 'Mario', patch: { franchise: 'Mario' } },
  { label: 'Zelda', patch: { franchise: 'Zelda' } },
  { label: 'Souls', patch: { franchise: 'Souls' } },
  { label: 'N64', patch: { platform: 'N64' } },
  { label: 'SNES', patch: { platform: 'SNES' } },
  { label: 'DOS classics', patch: { platform: 'DOS' } },
  { label: 'Sierra', patch: { publisher: 'Sierra' } },
  { label: 'id Software', patch: { developer: 'id Software' } },
  { label: 'Blizzard', patch: { publisher: 'Blizzard Entertainment' } },
  { label: 'Nintendo 90s', patch: { publisher: 'Nintendo', ymin: 1990, ymax: 1999 } },
  { label: 'Made in Germany', test: (g) => isGerman(g) },
  { label: 'CryEngine', test: (g) => g.engine === 'CryEngine' },
  { label: 'Unity', test: (g) => g.engine === 'Unity' },
  { label: 'Unreal', test: (g) => (g.engine ?? '').includes('Unreal') },
  { label: 'id Tech', test: (g) => (g.engine ?? '').includes('id Tech') },
]
const FILTER_KEY = 'gameguesser.filters'

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return DEFAULT_FILTERS
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
  const [gameId, setGameId] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('game')
    return getGame(fromUrl)?.id ?? randomGame().id
  })
  const [levelIdx, setLevelIdx] = useState(0)
  const [maxLevel, setMaxLevel] = useState(0)
  const [guess, setGuess] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [wrongs, setWrongs] = useState(0)
  const [hintUsed, setHintUsed] = useState(false)
  const [solved, setSolved] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [{ total, solved: solvedCount }, setScore] = useState(loadScore)
  const [filters, setFilters] = useState<Filters>(loadFilters)
  const [activePackage, setActivePackage] = useState<string | null>(null)
  const [initialSharedId] = useState(() => new URLSearchParams(window.location.search).get('game'))
  const [roundQueue, setRoundQueue] = useState<string[] | null>(null)
  const [roundResults, setRoundResults] = useState<Record<string, RoundResult>>({})
  const [showSummary, setShowSummary] = useState(false)
  // session no-repeat + random screenshot per appearance (shared links: primary)
  const seenRef = useRef<Set<string>>(new Set([gameId]))
  const [shotPos, setShotPos] = useState(0)

  const game = useMemo(() => getGame(gameId) ?? GAMES[0], [gameId])
  const filtered = useMemo(
    () =>
      GAMES.filter(
        (g) =>
          genreMatches(g.genre, filters.genre) &&
          (filters.publisher === 'All' || g.publisher === filters.publisher) &&
          (filters.platform === 'All' || g.platforms.includes(filters.platform)) &&
          (filters.developer === 'All' || g.developer === filters.developer) &&
          (filters.franchise === 'All' || franchiseOf(g) === filters.franchise) &&
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
    () => new URLSearchParams(window.location.search).get('game') === game.id,
    [game.id],
  )
  const finished = solved || gaveUp
  const points = pointsForLevel(maxLevel)

  const pickGame = useCallback(
    (id: string) => {
      setGameId(id)
      setLevelIdx(0)
      setMaxLevel(0)
      setGuess('')
      setAttempts(0)
      setWrongs(0)
      setHintUsed(false)
      setSolved(false)
      setGaveUp(false)
      setMessage(null)
      seenRef.current.add(id)
      const shots = shotsFor(getGame(id) ?? GAMES[0])
      setShotPos(id === initialSharedId ? 0 : Math.floor(Math.random() * shots.length))
      const url = new URL(window.location.href)
      url.searchParams.delete('game')
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

  const startRound = useCallback(() => {
    const n = Math.min(ROUND_SIZE, pool.length)
    if (n === 0) return
    const unseen = shuffle(pool.filter((g) => !seenRef.current.has(g.id)))
    const rest = shuffle(pool.filter((g) => seenRef.current.has(g.id)))
    const ids = [...unseen, ...rest].slice(0, n).map((g) => g.id)
    setRoundQueue(ids)
    setRoundResults({})
    setShowSummary(false)
    pickGame(ids[0])
  }, [pool, pickGame])

  // free play: prefer games not yet seen this session, reset when exhausted
  const nextFreePick = useCallback((excludeId?: string) => {
    const fresh = pool.filter((g) => g.id !== excludeId && !seenRef.current.has(g.id))
    if (fresh.length) return randomFrom(fresh).id
    seenRef.current.clear()
    return randomFrom(pool, excludeId).id
  }, [pool])

  const exitRound = useCallback(() => {
    setRoundQueue(null)
    setRoundResults({})
    setShowSummary(false)
  }, [])

  const giveUp = useCallback(() => {
    setGaveUp(true)
    setMessage(null)
    if (roundQueue !== null) {
      setRoundResults((r) => ({ ...r, [game.id]: { solved: false, points: 0, level: levelLabel(LEVELS[maxLevel]) } }))
    }
  }, [roundQueue, game.id, maxLevel])

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

  const submitGuess = useCallback(() => {
    if (finished || !guess.trim()) return
    const res = checkGuess(guess, game)
    if (res.correct) {
      // Exact title/alias match wins outright when unique ("gothic").
      // Otherwise: if this is the ONLY game the guess fits — however
      // partial ("resident evil biohazard" only fits RE7) — it solves.
      // Several fits → name it precisely ("🔎 Almost — …").
      const gnorm = normalize(guess)
      const exactHere =
        gnorm === normalize(game.title) || game.aliases.some((a) => normalize(a) === gnorm)
      const exactElsewhere =
        exactHere &&
        GAMES.some(
          (o) =>
            o.id !== game.id &&
            (normalize(o.title) === gnorm || o.aliases.some((a) => normalize(a) === gnorm)),
        )
      if (exactHere && !exactElsewhere) {
        // unique exact: solve below
      } else {
        // Not uniquely exact: solve only as the single fit. Rivals must
        // also cover the guess's numerals ("doom 2016" can't mean Doom 1993).
        const others = GAMES.filter(
          (o) => o.id !== game.id && checkGuess(guess, o).correct && numeralsCovered(guess, o),
        )
        if (others.length > 0) {
          const names = [game, ...others].slice(0, 4).map((g) => g.title).join(' · ')
          setAttempts((a) => a + 1)
          setMessage(`🔎 Almost — that fits several games (${names}). Which one exactly?`)
          return
        }
      }
      setSolved(true)
      const pts = Math.max(10, pointsForLevel(maxLevel) - (hintUsed ? HINT_COST : 0))
      const lvl = levelLabel(LEVELS[maxLevel])
      setScore((s) => ({ total: s.total + pts, solved: s.solved + 1 }))
      if (roundQueue !== null) {
        setRoundResults((r) => ({ ...r, [game.id]: { solved: true, points: pts, level: lvl } }))
      }
      setMessage(`✅ Correct! ${game.title} (${game.year}) — +${pts} pts at ${lvl}${hintUsed ? ` (incl. −${HINT_COST} hint)` : ''}.`)
    } else if (res.close) {
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
  }, [finished, guess, game, maxLevel, roundQueue, wrongs, levelIdx, hintUsed])

  const takeHint = useCallback(() => {
    if (finished || hintUsed) return
    setHintUsed(true)
    setMessage(null)
  }, [finished, hintUsed])

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
          <h1>🎮 GameGuesser</h1>
          <p className="sub">Guess the game from pixels. Start at 4×4 — reveal more, score less.</p>
        </div>
        <div className="score">
          <div><strong>{total}</strong> pts</div>
          <div className="muted">{solvedCount} solved</div>
        </div>
      </header>

      {isShared && (
        <div className="banner">
          🔗 Shared challenge: <strong>{game.title}</strong>? No spoilers — guess first, then forward it!
        </div>
      )}

      {roundQueue !== null && !showSummary && (
        <div className="banner">
          🏁 Round game {roundQueue.indexOf(gameId) + 1} of {roundQueue.length} · {roundPoints} pts so far{' '}
          <button onClick={exitRound}>Exit round</button>
        </div>
      )}

      <main className="card">
        {showSummary && roundQueue !== null ? (
          <div className="summary">
            <h2>🏁 Round over!</h2>
            <p><strong>{roundSolved}/{roundQueue.length}</strong> solved — <strong>{roundPoints} pts</strong></p>
            <div className="roundlist">
              {roundQueue.map((id) => {
                const g = getGame(id)
                if (!g) return null
                const r = roundResults[id]
                return (
                  <div key={id} className="roundrow">
                    <span>{r?.solved ? '✅' : '❌'} {g.title} <span className="muted">({g.year})</span></span>
                    <span className="muted">{r ? (r.solved ? `${r.points} pts @ ${r.level}` : `gave up (saw ${r.level})`) : '—'}</span>
                    <button
                      onClick={async () => {
                        const ok = await copyText(shareLink(id))
                        flash(ok ? 'Challenge link copied — share this game on Discord!' : 'Copy failed')
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
                  flash(ok ? 'Round result copied — paste it in Discord!' : 'Copy failed')
                }}
              >
                Copy round result for Discord
              </button>
              <button onClick={startRound}>New round</button>
              <button onClick={exitRound}>Free play</button>
            </div>
          </div>
        ) : (
          <>
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
          <label>
            Genre{' '}
            <select value={filters.genre} disabled={roundQueue !== null} onChange={(e) => updateFilters({ genre: e.target.value })}>
              {GENRE_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            Publisher{' '}
            <select value={filters.publisher} disabled={roundQueue !== null} onChange={(e) => updateFilters({ publisher: e.target.value })}>
              <option value="All">All</option>
              {PUBLISHERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Platform{' '}
            <select value={filters.platform} disabled={roundQueue !== null} onChange={(e) => updateFilters({ platform: e.target.value })}>
              <option value="All">All</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Developer{' '}
            <select value={filters.developer} disabled={roundQueue !== null} onChange={(e) => updateFilters({ developer: e.target.value })}>
              <option value="All">All</option>
              {DEVELOPERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Franchise{' '}
            <select value={filters.franchise} disabled={roundQueue !== null} onChange={(e) => updateFilters({ franchise: e.target.value })}>
              <option value="All">All</option>
              {FRANCHISES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox" checked={filters.showNiche} disabled={roundQueue !== null}
              onChange={(e) => updateFilters({ showNiche: e.target.checked })}
            />{' '}
            fan picks
          </label>
          <label>
            From{' '}
            <input
              type="number" min={YEAR_MIN} max={YEAR_MAX} value={filters.ymin} disabled={roundQueue !== null}
              onChange={(e) => updateFilters({ ymin: Number(e.target.value) || YEAR_MIN })}
            />
          </label>
          <label>
            To{' '}
            <input
              type="number" min={YEAR_MIN} max={YEAR_MAX} value={filters.ymax} disabled={roundQueue !== null}
              onChange={(e) => updateFilters({ ymax: Number(e.target.value) || YEAR_MAX })}
            />
          </label>
          <button onClick={() => { setFilters(DEFAULT_FILTERS); setActivePackage(null) }} disabled={roundQueue !== null}>Reset</button>
          <button className="primary" onClick={startRound} disabled={pool.length === 0}>
            Start round ({Math.min(ROUND_SIZE, pool.length)})
          </button>
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
        <div className="levels">
          {LEVELS.map((lvl, i) => (
            <button
              key={lvl.size}
              className={`chip ${i === levelIdx ? 'active' : ''} ${i <= maxLevel ? 'seen' : ''}`}
              onClick={() => !finished && i <= maxLevel && setLevelIdx(i)}
              disabled={finished || i > maxLevel}
              title={`${levelLabel(lvl)} — ${lvl.points} pts`}
            >
              {levelLabel(lvl)} · {lvl.points}
            </button>
          ))}
        </div>

        <PixelCanvas key={game.id} srcs={shotsFor(game)} startAt={shotPos} resolution={LEVELS[levelIdx].size} seed={game.id} />
        <div className="meta">
          <span>Level: <strong>{levelLabel(LEVELS[levelIdx])}</strong></span>
          <span>Worth: <strong>{points} pts</strong></span>
          <span className="muted">Attempts: {attempts}</span>
        </div>

        {!finished ? (
          <form
            className="guessrow"
            onSubmit={(e) => {
              e.preventDefault()
              submitGuess()
            }}
          >
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="Which game is this? e.g. Final Fantasy"
              autoFocus
            />
            <button type="submit" className="primary">Guess</button>
            <button type="button" onClick={revealMore} disabled={levelIdx >= LEVELS.length - 1}>
              Reveal more (−pts)
            </button>
            <button type="button" onClick={takeHint} disabled={hintUsed} title={`Show title shape (${HINT_COST} pts)`}>
              Hint (−{HINT_COST})
            </button>
          </form>
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
                  const ok = await copyText(shareLink(game.id))
                  flash(ok ? 'Challenge link copied — paste it in Discord!' : 'Copy failed')
                }}
              >
                Share this level on Discord
              </button>
              {solved && (
                <button
                  onClick={async () => {
                    const earned = Math.max(10, pointsForLevel(maxLevel) - (hintUsed ? HINT_COST : 0))
                    const ok = await copyText(discordResultText(game, maxLevel, earned))
                    flash(ok ? 'Result copied — paste it in Discord!' : 'Copy failed')
                  }}
                >
                  Copy result for Discord
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

        {hintUsed && !finished && (
          <p className="message">🔤 Title shape: <code>{titleMask(game.title)}</code></p>
        )}

        {message && <p className="message">{message}</p>}
        {toast && <div className="toast">{toast}</div>}

        {!finished && (
          <div className="btnrow">
            <button
              onClick={async () => {
                const ok = await copyText(shareLink(game.id))
                flash(ok ? 'Challenge link copied — paste it in Discord!' : 'Copy failed')
              }}
            >
              Share this level on Discord
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
          <summary>How scoring & Discord sharing works</summary>
          <ul>
            <li>Each level is one game. You start at <strong>4×4</strong> ({LEVELS[0].points} pts). Every reveal halves the points down to full image.</li>
            <li>Near answers count: <em>“final fantasy”</em> is accepted for <em>Final Fantasy VII</em>, typos and aliases like <em>gta 5</em> too.</li>
            <li><strong>Rounds:</strong> set genre / publisher / platform / year filters, then “Start round” plays 10 random levels from that pool. The summary lets you share any single game and copy the round result to Discord.</li>
            <li><strong>Discord:</strong> “Share this level” copies a link like <code>?game=elden-ring</code>. Paste it in a channel — anyone opening it plays the exact same level. After solving, “Copy result” gives you a message with your score to paste back so the channel can compare.</li>
          </ul>
        </details>

        <details className="games">
          <summary>Levels in view: {pool.length} (spoilers!)</summary>
          <div className="gamelist">
            {pool.map((g) => (
              <button key={g.id} className={g.id === game.id ? 'active' : ''} onClick={() => { if (roundQueue !== null) exitRound(); pickGame(g.id) }}>
                {g.title} <span className="muted">({g.year}, {g.genre})</span>
              </button>
            ))}
          </div>
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
    </div>
  )
}

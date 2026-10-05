import { describe, expect, it, beforeEach } from 'vitest'
import { LEVELS, YEAR_MAX, YEAR_MIN, discordChallengeText, discordResultText, earnedPoints, findSharedGame, findSharedRound, formatSales, gameCode, gridLabel, levelLabel, parseSharedPool, platformHit, pointsForLevel, preferFresh, randomFrom, resolveShot, roundLink, shareLink, shotsFor, shuffle } from './game'
import { GAMES, getGame } from '../data/games'
import type { GameEntry } from '../data/games'

const g = (over: Partial<GameEntry> = {}): GameEntry => ({
  id: 'x',
  title: 'X',
  year: 2000,
  genre: 'Action',
  publisher: 'P',
  developer: 'D',
  platforms: ['PC'],
  aliases: [],
  screenshot: '/screenshots/2000/x.jpg',
  ...over,
})

describe('levels', () => {
  it('starts at 16x16 for 500 pts and decays incl. 48x48', () => {
    expect(LEVELS[0]).toEqual({ size: 16, points: 500 })
    expect(LEVELS.map((l) => l.size)).toEqual([16, 32, 48, 64, 96, 0])
    expect(LEVELS.map((l) => l.size)).toContain(96)
    expect(LEVELS[LEVELS.length - 1]).toEqual({ size: 0, points: 50 })
    const pts = LEVELS.map((l) => l.points)
    expect([...pts].sort((a, b) => b - a)).toEqual(pts)
  })
  it('labels levels incl. full', () => {
    expect(levelLabel({ size: 16, points: 250 })).toBe('16×16')
    expect(levelLabel({ size: 0, points: 20 })).toBe('Full')
    expect(pointsForLevel(99)).toBe(50)
  })
  it('gridLabel follows the screenshot aspect, falls back to square', () => {
    expect(gridLabel(0, 1.78)).toBe('Full')
    expect(gridLabel(96, null)).toBe('96×96')
    expect(gridLabel(96, 16 / 9)).toBe('96×54')
    expect(gridLabel(32, 4 / 3)).toBe('32×24')
    expect(gridLabel(16, 0.75)).toBe('12×16')
  })
  it('earnedPoints halves per hint stage, floored at 10', () => {
    expect(earnedPoints(0, 0)).toBe(500)
    expect(earnedPoints(0, 1)).toBe(250)
    expect(earnedPoints(0, 2)).toBe(125)
    expect(earnedPoints(5, 0)).toBe(50)
    expect(earnedPoints(5, 1)).toBe(25)
    expect(earnedPoints(5, 2)).toBe(12)
    expect(earnedPoints(3, 2)).toBe(50)
  })
  it('shuffle keeps elements', () => {
    const arr = [g({ id: 'a' }), g({ id: 'b' }), g({ id: 'c' })]
    expect(shuffle(arr).map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('shot URLs', () => {
  it('passes CDN URLs through and resolves local paths against the base', () => {
    expect(resolveShot('https://images.igdb.com/x.jpg')).toBe('https://images.igdb.com/x.jpg')
    const local = resolveShot('screenshots/2000/x.jpg')
    expect(local.endsWith('screenshots/2000/x.jpg')).toBe(true)
    expect(local.startsWith('http')).toBe(false)
    // legacy absolute entries keep working
    expect(resolveShot('/screenshots/2000/x.jpg')).toBe(local)
  })
  it('prefers remote shots, keeps working pool-wide', () => {
    const withRemote = g({ remote: 'https://images.igdb.com/x.jpg', remoteAlts: ['https://images.igdb.com/y.jpg'] })
    const shots = shotsFor(withRemote)
    expect(shots[0]).toBe('https://images.igdb.com/x.jpg')
    expect(shots).toContain('https://images.igdb.com/y.jpg')
    for (const game of GAMES) {
      for (const s of shotsFor(game)) {
        expect(s.startsWith('http') || s.includes('screenshots/'), game.id).toBe(true)
      }
    }
  })
})

describe('share texts', () => {
  beforeEach(() => {
    ;(globalThis as any).window = { location: new URL('http://localhost:5174/') }
  })
  it('result text names the game, challenge text never does', () => {
    const game = g({ id: 'tetris', title: 'Tetris', year: 1984 })
    const result = discordResultText(game, 2, 250)
    expect(result).toContain('Tetris')
    expect(result).toContain('48×48')
    expect(result).toContain('?game=')
    const challenge = discordChallengeText(game, 2, 250)
    expect(challenge).toContain('48×48')
    expect(challenge).toContain('?game=')
    expect(challenge).not.toContain('Tetris')
    expect(challenge).not.toContain('1984')
  })
  it('shareLink carries pool context, stays short when default', () => {
    ;(globalThis as any).window = { location: new URL('http://localhost:5174/') }
    const plain = shareLink('tetris', null)
    expect(plain).toContain('game=')
    expect(plain).not.toContain('pkg=')
    const withPool = shareLink('tetris', {
      pkg: 'SNES', genres: [], publishers: [], platforms: [], developers: [],
      franchises: [], showNiche: false, ymin: 1990, ymax: 1999,
    })
    expect(withPool).toContain('pkg=SNES')
    expect(withPool).toContain('ymin=1990')
    expect(withPool).toContain('ymax=1999')
    expect(withPool).not.toContain('niche')
  })
})

describe('round links', () => {
  /** Deterministic RNG for distribution tests (mulberry32) — zero flake. */
  const withSeed = (seed: number, fn: () => void) => {
    const orig = Math.random
    let s = seed
    Math.random = () => {
      s |= 0
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    try {
      fn()
    } finally {
      Math.random = orig
    }
  };  beforeEach(() => {
    ;(globalThis as any).window = { location: new URL('http://localhost:5174/') }
  })
  it('round-trips codes in order with clamped index', () => {
    const ids = ['tetris', 'doom', 'pac-man']
    const sp = new URL(roundLink(ids, 1)).searchParams
    expect(findSharedRound(GAMES, sp.get('round')!, Number(sp.get('i')))).toEqual({
      ids,
      pos: 1,
      shots: [null, null, null],
      dropped: 0,
    })
    expect(findSharedRound(GAMES, 'zzzzzzz', 0)).toBeNull()
    expect(findSharedRound(GAMES, sp.get('round')!, 99)?.pos).toBe(2)
  })
  it('round links carry per-game screenshots', () => {
    const ids = ['tetris', 'doom']
    const sp = new URL(roundLink(ids, 0, [2, null])).searchParams
    expect(sp.get('round')).toMatch(/~2/)
    expect(findSharedRound(GAMES, sp.get('round')!, 0)).toEqual({ ids, pos: 0, shots: [2, null], dropped: 0 })
  })
  it('findSharedRound counts codes that no longer resolve', () => {
    const ids = ['tetris', 'doom']
    const sp = new URL(roundLink(ids, 0, [null, null])).searchParams
    const withBogus = `${sp.get('round')},zzzzzzz`
    const parsed = findSharedRound(GAMES, withBogus, 0)!
    expect(parsed.ids).toEqual(ids)
    expect(parsed.dropped).toBe(1)
  })
  it('parseSharedPool ignores absent years (no 0-0) and reads shots', () => {
    const pkgs: string[] = ['SNES']
    expect(parseSharedPool(new URLSearchParams('foo=1'), pkgs)).toBeNull()
    const bare = parseSharedPool(new URLSearchParams('game=abc&plat=DOS'), pkgs)!
    expect(bare.patch.ymin).toBeUndefined()
    expect(bare.patch.platforms).toEqual(['DOS'])
    expect(bare.label).toBe('1 filter')
    const full = parseSharedPool(
      new URLSearchParams('game=abc&pkg=SNES&ymin=1990&ymax=1999&niche=1&g=RPG+%28all%29'),
      pkgs,
    )!
    expect(full.pkg).toBe('SNES')
    expect(full.patch.ymin).toBe(1990)
    expect(full.patch.showNiche).toBe(true)
    const bad = parseSharedPool(new URLSearchParams('game=abc&pkg=Nope&plat=DOS'), pkgs)!
    expect(bad.pkg).toBeNull()
    expect(bad.patch.platforms).toEqual(['DOS'])
  })
  it('parseSharedPool strips unknown facet values but keeps the known ones', () => {
    const pkgs: string[] = ['SNES']
    const mixed = parseSharedPool(new URLSearchParams('game=abc&plat=DOS&plat=NopeBox&pub=NopeSoft'), pkgs)!
    expect(mixed.patch.platforms).toEqual(['DOS'])
    expect(mixed.patch.publishers).toBeUndefined()
    const allBad = parseSharedPool(new URLSearchParams('game=abc&plat=NopeBox'), pkgs)
    expect(allBad).toBeNull()
  })
  it('parseSharedPool clamps years into bounds and repairs inverted ends', () => {
    const pkgs: string[] = ['SNES']
    const wild = parseSharedPool(new URLSearchParams('game=abc&ymin=3000&ymax=1800'), pkgs)!
    expect(wild.patch.ymin).toBe(YEAR_MIN)
    expect(wild.patch.ymax).toBe(YEAR_MAX)
    const flipped = parseSharedPool(new URLSearchParams('game=abc&ymin=2000&ymax=1990'), pkgs)!
    expect(flipped.patch.ymin).toBe(1990)
    expect(flipped.patch.ymax).toBe(2000)
  })
  it('randomFrom returns undefined on an empty pool instead of throwing on .id', () => {
    expect(randomFrom([])).toBeUndefined()
    expect(randomFrom([], 'x')).toBeUndefined()
  })
  it('shotsFor keeps a frozen order (share links index into it positionally)', () => {
    expect(shotsFor(getGame('tetris')!)).toEqual([
      'https://images.igdb.com/igdb/image/upload/t_1080p/scmhs5.jpg',
      '/screenshots/1984/tetris.jpg',
      'https://images.igdb.com/igdb/image/upload/t_1080p/scmhs6.jpg',
      'https://images.igdb.com/igdb/image/upload/t_1080p/scmhs4.jpg',
      '/screenshots/1984/tetris-2.jpg',
      '/screenshots/1984/tetris-3.jpg',
    ])
  })
  it('formatSales prints approximate figures without false precision', () => {
    expect(formatSales(225000000)).toBe('≈225M copies')
    expect(formatSales(82900000)).toBe('≈82.9M copies')
    expect(formatSales(5000)).toBe('≈5k copies')
    expect(formatSales(1500)).toBe('≈1.5k copies')
    expect(formatSales(350)).toBe('≈350 copies')
  })
  it('platformHit matches direct, Others, and empty', () => {
    expect(platformHit(['DOS'], [], ['Vectrex'])).toBe(true)
    expect(platformHit(['DOS'], ['DOS'], ['Vectrex'])).toBe(true)
    expect(platformHit(['DOS'], ['SNES'], ['Vectrex'])).toBe(false)
    expect(platformHit(['Vectrex'], ['Others'], ['Vectrex'])).toBe(true)
    expect(platformHit(['DOS'], ['Others'], ['Vectrex'])).toBe(false)
  })
  it('preferFresh orders never-played before seen, keeps all', () => {
    const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const session = new Set(['c'])
    const persisted = new Set(['b', 'c'])
    for (let k = 0; k < 20; k++) {
      const out = preferFresh(pool, session, persisted).map((x) => x.id)
      expect(out).toHaveLength(4)
      expect(out.slice(0, 2).sort()).toEqual(['a', 'd'])
      expect(out[2]).toBe('b')
      expect(out[3]).toBe('c')
    }
  })
  it('distribution: 84 rounds of 10 from 84 games covers evenly', () => {
    withSeed(1234, () => {
    const pool = Array.from({ length: 84 }, (_, i) => ({ id: `g${i}` }))
    const counts = new Map<string, number>()
    for (let r = 0; r < 84; r++) {
      for (const g of shuffle(pool).slice(0, 10)) {
        counts.set(g.id, (counts.get(g.id) ?? 0) + 1)
      }
    }
    const vals = [...counts.values()]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    // eslint-disable-next-line no-console
    console.log(`round coverage over 84 games: min=${min} max=${max} (expected ~10 each)`)
    expect(counts.size).toBe(84)
    expect(min).toBeGreaterThan(2)
    expect(max).toBeLessThan(22)
    })
  })
  it('distribution: shot rotation over 4 shots is even', () => {
    withSeed(1234, () => {
    const counts = [0, 0, 0, 0]
    for (let k = 0; k < 4000; k++) counts[Math.floor(Math.random() * 4)]++
    // eslint-disable-next-line no-console
    console.log(`shot rotation: ${counts.join('/')} (expected ~1000 each)`)
    for (const c of counts) {
      expect(c).toBeGreaterThan(850)
      expect(c).toBeLessThan(1150)
    }
    })
  })
  it('distribution: first pick of a fresh pool is uniform', () => {
    withSeed(1234, () => {
    const pool = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}` }))
    const firsts = new Map<string, number>()
    for (let k = 0; k < 800; k++) {
      const id = preferFresh(pool, new Set(), new Set())[0].id
      firsts.set(id, (firsts.get(id) ?? 0) + 1)
    }
    const vals = [...firsts.values()]
    // eslint-disable-next-line no-console
    console.log(`first picks over 20 games: min=${Math.min(...vals)} max=${Math.max(...vals)} (expected ~40 each)`)
    expect(firsts.size).toBe(20)
    for (const c of vals) {
      expect(c).toBeGreaterThan(15)
      expect(c).toBeLessThan(70)
    }
    })
  })
})

describe('share codes', () => {
  it('is stable, short and opaque', () => {
    const code = gameCode('heroes-of-might-and-magic-ii-the-succession-wars')
    expect(code).toMatch(/^[0-9a-f]{7}$/)
    expect(code).not.toContain('heroes')
    expect(gameCode('heroes-of-might-and-magic-ii-the-succession-wars')).toBe(code)
  })
  it('resolves codes and legacy plain ids', () => {
    const code = gameCode('tetris')
    expect(findSharedGame(GAMES, code)?.id).toBe('tetris')
    expect(findSharedGame(GAMES, 'tetris')?.id).toBe('tetris')
    expect(findSharedGame(GAMES, 'nope')).toBeUndefined()
  })
  it('has no collisions across the whole pool', () => {
    const codes = GAMES.map((x) => gameCode(x.id))
    expect(new Set(codes).size).toBe(codes.length)
  })
})

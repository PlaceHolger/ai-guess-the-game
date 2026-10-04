import { describe, expect, it } from 'vitest'
import { LEVELS, findSharedGame, gameCode, levelLabel, pointsForLevel, resolveShot, shotsFor, shuffle } from './game'
import { GAMES } from '../data/games'
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
  it('starts at 4x4 for 1000 pts and decays incl. 96x96', () => {
    expect(LEVELS[0]).toEqual({ size: 4, points: 1000 })
    expect(LEVELS.map((l) => l.size)).toContain(96)
    expect(LEVELS[LEVELS.length - 1]).toEqual({ size: 0, points: 20 })
    const pts = LEVELS.map((l) => l.points)
    expect([...pts].sort((a, b) => b - a)).toEqual(pts)
  })
  it('labels levels incl. full', () => {
    expect(levelLabel({ size: 16, points: 250 })).toBe('16×16')
    expect(levelLabel({ size: 0, points: 20 })).toBe('Full')
    expect(pointsForLevel(99)).toBe(20)
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

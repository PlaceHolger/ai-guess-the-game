import { describe, expect, it } from 'vitest'
import { LEVELS, levelLabel, pointsForLevel, shuffle } from './game'
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

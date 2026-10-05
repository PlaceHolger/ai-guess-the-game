import { describe, expect, it } from 'vitest'
import { GAMES, getGame } from './games'
import { SALES } from './sales'
import { normalize } from '../lib/fuzzy'

describe('catalog integrity', () => {
  it('has unique ids', () => {
    const ids = GAMES.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every entry has the required fields', () => {
    for (const g of GAMES) {
      expect(g.id, 'id').toMatch(/^[a-z0-9-]+$/)
      expect(g.title.length, `${g.id} title`).toBeGreaterThan(1)
      expect(g.year, `${g.id} year`).toBeGreaterThanOrEqual(1970)
      expect(g.year, `${g.id} year`).toBeLessThanOrEqual(2026)
      expect(g.platforms.length, `${g.id} platforms`).toBeGreaterThan(0)
      expect(g.screenshot, `${g.id} screenshot`).toMatch(/^(?:\/)?screenshots\/\d+\//)
    }
  })
  it('no two entries share an IGDB id (same game twice)', () => {
    const seen = new Map<number, string>()
    for (const g of GAMES) {
      if (g.igdbId === undefined) continue
      expect(seen.get(g.igdbId), `igdbId ${g.igdbId} on ${g.id} and ${seen.get(g.igdbId)}`).toBeUndefined()
      seen.set(g.igdbId, g.id)
    }
  })
  it('no exact title+year duplicates', () => {
    const seen = new Map<string, string>()
    for (const g of GAMES) {
      const key = `${normalize(g.title)}@${g.year}`
      expect(seen.get(key), `"${g.title}" (${g.year}) duplicates ${seen.get(key)}`).toBeUndefined()
      seen.set(key, g.id)
    }
  })
  it('getGame resolves and misses as expected', () => {
    expect(getGame('tetris')?.title).toBe('Tetris')
    expect(getGame('no-such-game')).toBeUndefined()
    expect(getGame(null)).toBeUndefined()
  })
  it('every sales figure resolves to a real entry', () => {
    for (const id of Object.keys(SALES)) expect(getGame(id), id).toBeDefined()
    expect(Object.keys(SALES).length).toBeGreaterThan(0)
  })
  it('no alias normalizes to its own title, platforms hold no duplicates', () => {
    const badAlias: string[] = []
    const badPlats: string[] = []
    for (const g of GAMES) {
      const nt = normalize(g.title)
      for (const a of g.aliases) {
        if (a && normalize(a) === nt) badAlias.push(`${g.id}: "${a}"`)
      }
      if (new Set(g.platforms).size !== g.platforms.length) badPlats.push(g.id)
    }
    expect(badAlias).toEqual([])
    expect(badPlats).toEqual([])
  })
  it('lists near-duplicates for manual review (informational)', () => {
    // same-year titles where one contains the other: potential double levels
    const norm = (t: string) => normalize(t)
    const flagged: string[] = []
    for (const a of GAMES) {
      for (const b of GAMES) {
        if (a.id >= b.id || a.year !== b.year) continue
        const na = norm(a.title)
        const nb = norm(b.title)
        if (na !== nb && (na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) >= 8) {
          flagged.push(`${a.id} <-> ${b.id}`)
        }
      }
    }
    // eslint-disable-next-line no-console
    if (flagged.length) console.log(`near-dupe pairs for review (${flagged.length}):`, flagged.slice(0, 20).join(', '))
  })
})

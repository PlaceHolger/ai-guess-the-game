import { describe, expect, it } from 'vitest'
import { checkGuess, isMoreSpecific, normalize, numeralsCovered, titleMask, tokenIncludes } from './fuzzy'
import { GAMES, getGame } from '../data/games'
import type { GameEntry } from '../data/games'

const g = (id: string, title: string, aliases: string[] = []): GameEntry => ({
  id,
  title,
  year: 2000,
  genre: 'Action',
  publisher: 'P',
  developer: 'D',
  platforms: ['PC'],
  aliases,
  screenshot: '/x.jpg',
})

describe('normalize', () => {
  it('lowercases, strips diacritics and punctuation', () => {
    expect(normalize('Pokémon: Red/Blue!')).toBe('pokemon red blue')
    expect(normalize('  Half-Life 2  ')).toBe('half life 2')
  })
})

describe('checkGuess basics', () => {
  const doom = g('doom', 'DOOM', ['doom 1'])
  it('accepts exact matches case-insensitively', () => {
    expect(checkGuess('doom', doom).correct).toBe(true)
    expect(checkGuess('DOOM', doom).correct).toBe(true)
    expect(checkGuess('Doom', doom).correct).toBe(true)
  })
  it('accepts aliases', () => {
    expect(checkGuess('doom 1', doom).correct).toBe(true)
  })
  it('accepts base titles ("final fantasy" for VII)', () => {
    const ff7 = g('ff7', 'Final Fantasy VII', ['final fantasy 7', 'final fantasy'])
    expect(checkGuess('final fantasy', ff7).correct).toBe(true)
  })
  it('accepts typos, rejects unrelated', () => {
    const ff7 = g('ff7', 'Final Fantasy VII', [])
    expect(checkGuess('final fantazy vii', ff7).correct).toBe(true)
    expect(checkGuess('tetris', ff7).correct).toBe(false)
    expect(checkGuess('the', ff7).correct).toBe(false)
  })
  it('accepts prefix typing', () => {
    expect(checkGuess('tetr', g('tetris', 'Tetris')).correct).toBe(true)
  })
  it('short alias "king" does not match inside "kingdom" (Zelda ≠ King\'s Quest)', () => {
    const kq2 = g('kq2', "King's Quest II: Romancing the Throne", ['kq2', 'king', "king's quest 2"])
    const kq3 = g('kq3', "King's Quest III: To Heir is Human", ['kq3', 'king', "king's quest 3"])
    const totk = g('totk', 'The Legend of Zelda: Tears of the Kingdom', ['zelda totk', 'totk'])
    expect(checkGuess('zelda tears of the kingdom', kq2).correct).toBe(false)
    expect(checkGuess('zelda tears of the kingdom', kq3).correct).toBe(false)
    expect(checkGuess('zelda tears of the kingdom', totk).correct).toBe(true)
    expect(checkGuess('king', kq2).correct).toBe(true)
    expect(checkGuess('kingdom', kq2).correct).toBe(false)
  })
  it('edition words are never load-bearing', () => {
    const hitman = g('hitman-goty', 'Hitman: Game of the Year Edition', [])
    expect(checkGuess('hitman', hitman).correct).toBe(true)
    expect(checkGuess('hitman goty edition', hitman).correct).toBe(true)
    expect(checkGuess('edition', hitman).correct).toBe(false)
  })
})

describe('numeral strictness (ii ≠ iii)', () => {
  const rs2 = g('rs2', 'Star Wars: Rogue Squadron II - Rogue Leader')
  const rs3 = g('rs3', 'Star Wars: Rogue Squadron III - Rebel Strike')
  it('matches the right sequel', () => {
    expect(checkGuess('Star Wars: Rogue Squadron II', rs2).correct).toBe(true)
    expect(checkGuess('Star Wars: Rogue Squadron II', rs3).correct).toBe(false)
  })
  it('treats gothic 2 and gothic ii the same', () => {
    const gii = g('gothic-ii', 'Gothic II')
    expect(checkGuess('gothic 2', gii).correct).toBe(true)
    expect(checkGuess('gothic ii', gii).correct).toBe(true)
  })
})

describe('short-alias typo guard', () => {
  it('"gothic" is wrong (not close) for Risen 3 despite alias "rtl"', () => {
    const risen = g('r3', 'Risen 3: Titan Lords', ['rtl'])
    const res = checkGuess('gothic', risen)
    expect(res.correct).toBe(false)
    expect(res.close).toBe(false)
  })
  it('short acronyms still match exactly', () => {
    const gta = g('gta-v', 'Grand Theft Auto V', ['gta 5', 'gta v'])
    expect(checkGuess('gta 5', gta).correct).toBe(true)
    expect(checkGuess('gta v', gta).correct).toBe(true)
  })
  it('bare "ii" never matches', () => {
    const rs2 = g('rs2', 'Star Wars: Rogue Squadron II - Rogue Leader')
    expect(checkGuess('ii', rs2).correct).toBe(false)
  })
})

describe('isMoreSpecific', () => {
  it('"silent hill 4" settles SH1/SH2, "silent hill" does not', () => {
    expect(isMoreSpecific('silent hill 4', "Silent Hill 4: The Room", 'Silent Hill')).toBe(true)
    expect(isMoreSpecific('silent hill 4', "Silent Hill 4: The Room", 'Silent Hill 2')).toBe(true)
    expect(isMoreSpecific('silent hill', "Silent Hill 4: The Room", 'Silent Hill')).toBe(false)
    expect(isMoreSpecific('final fantasy', 'Final Fantasy VII', 'Final Fantasy')).toBe(false)
  })
  it('roman and arabic numerals unify', () => {
    expect(isMoreSpecific('final fantasy 7', 'Final Fantasy VII', 'Final Fantasy')).toBe(true)
  })
})

describe('numeralsCovered', () => {
  const mk = (title: string, aliases: string[] = []) => g('x', title, aliases)
  it('"gothic 1" cannot mean Gothic II, and needs no title containing 1', () => {
    expect(numeralsCovered('gothic 1', mk('Gothic II'))).toBe(false)
    expect(numeralsCovered('gothic 1', mk('Game 1'))).toBe(true)
    expect(numeralsCovered('gothic', mk('Gothic II'))).toBe(true)
  })
  it('numeral-free guesses pass everything', () => {
    expect(numeralsCovered('gothic', mk('Gothic II'))).toBe(true)
  })
})

describe('titleMask', () => {
  it('masks letters/digits, keeps structure', () => {
    expect(titleMask('Silent Hill 4: The Room')).toBe('______ ____ _: ___ ____')
    expect(titleMask("God of War Ragnarök")).toBe('___ __ ___ ________')
  })
})

describe('credit matching (developer/publisher nudges)', () => {
  const toks = (s: string) => normalize(s).split(' ').filter(Boolean)
  it('dev names match by token run, prefix allowed on the typed side', () => {
    expect(tokenIncludes(toks('Daedalic Entertainment'), toks('daedalic'), true)).toBe(true)
    expect(tokenIncludes(toks('Daedalic Entertainment'), toks('daedal'), true)).toBe(true)
    expect(tokenIncludes(toks('Piranha Bytes'), toks('bytes'), true)).toBe(true)
    expect(tokenIncludes(toks('id Software'), toks('soft'), true)).toBe(true)
    expect(tokenIncludes(toks('Rare'), toks('rarely'), true)).toBe(false)
    expect(tokenIncludes(toks('Sierra On-Line'), toks('online'), true)).toBe(false)
  })
})

describe('regional & short names (real pool)', () => {
  const fits = (guess: string) =>
    GAMES.filter((o) => checkGuess(guess, o).correct && numeralsCovered(guess, o)).map((o) => o.id)
  it('"gta 5" and "botw" solve exactly one game each', () => {
    expect(fits('gta 5')).toEqual(['gta-v'])
    expect(fits('botw')).toEqual(['breath-of-the-wild'])
  })
  it('"biohazard" reaches Resident Evil (ambiguity across the series is fine)', () => {
    expect(checkGuess('biohazard', getGame('resident-evil')!).correct).toBe(true)
    expect(fits('biohazard')).toContain('resident-evil')
  })
  it('german "siedler" reaches the Settlers games', () => {
    const ids = fits('die siedler')
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => /settler|serf-city/i.test(id))).toBe(true)
  })
  it('"final fantasy" is genuinely ambiguous these days (help example retired)', () => {
    expect(fits('final fantasy').length).toBeGreaterThan(5)
  })
  it('"gothic 4" means Arcania — never Gothic 3 (numerals are typo-immune)', () => {
    expect(checkGuess('gothic 4', getGame('arcania-gothic-4')!).correct).toBe(true)
    const g3 = checkGuess('gothic 4', getGame('gothic-3')!)
    expect(g3.correct).toBe(false)
    expect(g3.close).toBe(true)
    expect(fits('gothic 4')).toEqual(['arcania-gothic-4'])
  })
})

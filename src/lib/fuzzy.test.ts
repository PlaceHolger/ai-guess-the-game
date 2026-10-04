import { describe, expect, it } from 'vitest'
import { checkGuess, isMoreSpecific, normalize, numeralsCovered, titleMask } from './fuzzy'
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

// @vitest-environment jsdom
/** Smoke test for the play screen: type a wrong guess, submit, get feedback. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App'

// Deterministic game for solve-path tests (random would need the answer key).
vi.mock('./lib/game', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./lib/game')>()
  const data = await import('./data/games')
  return { ...mod, randomGame: () => data.getGame('tetris')! }
})

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('takes a wrong guess and asks to try again', () => {
    render(<App />)
    expect(screen.getByText('🎮 Guess the Game')).toBeTruthy()
    const input = screen.getByPlaceholderText('Which game is this?')
    fireEvent.change(input, { target: { value: 'definitely not a real game xyz' } })
    fireEvent.click(screen.getByText('Guess'))
    expect(screen.getByText(/Nope, try again/).textContent).toMatch(/Nope/)
  })

  it('shakes the Guess button on a wrong guess', () => {
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Which game is this?'), { target: { value: 'definitely not a real game xyz' } })
    expect(screen.getByText('Guess').className).not.toMatch(/shake/)
    fireEvent.click(screen.getByText('Guess'))
    expect(screen.getByText('Guess').className).toMatch(/shake/)
    expect(screen.getByText('1', { selector: '.attempts-pop' }).textContent).toBe('1')
  })

  it('solves an exact autocomplete pick with year suffix', () => {
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Which game is this?'), { target: { value: 'Tetris (1984)' } })
    fireEvent.click(screen.getByText('Guess'))
    expect(screen.getByText(/Correct! Tetris/).textContent).toMatch(/Correct/)
  })

  it('flashes a checkmark over the shot on a correct guess', () => {
    const { container } = render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Which game is this?'), { target: { value: 'tetris' } })
    fireEvent.click(screen.getByText('Guess'))
    expect(screen.getByText(/Correct! Tetris/).textContent).toMatch(/Correct/)
    expect(container.querySelector('.correct-flash')).not.toBeNull()
    expect(container.querySelector('.shotwrap.solved')).not.toBeNull()
  })

  it('uses unique keys for siblings (same key duplicates/omits DOM nodes)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<App />)
      const dupes = err.mock.calls.filter((c) => String(c[0]).includes('same key'))
      expect(dupes).toEqual([])
    } finally {
      err.mockRestore()
    }
  })
})

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
  window.sessionStorage.clear()
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

  it('explains locked filters when a round is running', () => {
    render(<App />)
    fireEvent.click(screen.getByText('⚙ New game'))
    fireEvent.click(screen.getByText(/Start round \(10\)/))
    expect(screen.getByText(/Round game 1 of 10/)).toBeTruthy()
    fireEvent.click(screen.getByText('⚙ New game'))
    expect(screen.getByText(/a round is running/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Star Wars/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('redirects an exact other-game pick without parroting it', () => {
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Which game is this?'), { target: { value: 'Pac-Man (1980)' } })
    fireEvent.click(screen.getByText('Guess'))
    const msg = screen.getByText(/not the correct answer for this level!/).textContent ?? ''
    expect(msg).toMatch(/Your guess "Pac-Man \(1980\)" is not/)
    expect(msg).not.toMatch(/is Pac-Man/)
  })

  it('warns on an unknown shared game instead of playing silently', () => {
    window.history.replaceState(null, '', '/?game=zzzzzzz')
    try {
      render(<App />)
      expect(screen.getByText(/isn't in the pool/).textContent).toMatch(/random level instead/)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('every package yields a full round in the default view', () => {
    render(<App />)
    fireEvent.click(screen.getByText('⚙ New game'))
    const labels = ['Star Wars', 'Pokémon', 'Mario', 'Zelda', 'Soulslikes', 'N64', 'SNES', 'DOS classics', 'Sierra', 'id Software', 'Blizzard', 'Nintendo 90s', 'Made in Germany', 'CryEngine', 'Unity', 'Unreal', 'id Tech']
    for (const label of labels) {
      fireEvent.click(screen.getByRole('button', { name: `📦 ${label}` }))
      const span = screen.getByText(
        (_, el) => el?.tagName === 'SPAN' && (el.textContent ?? '').includes(`📦 ${label}`),
      )
      const n = Number((span.textContent ?? '').split('/')[0].trim())
      expect(n, label).toBeGreaterThanOrEqual(10)
    }
  })

  it('caps repeat solves at 10 pts in the message', () => {
    window.localStorage.setItem('gameguesser.seenGames', JSON.stringify({ tetris: true }))
    try {
      render(<App />)
      fireEvent.change(screen.getByPlaceholderText('Which game is this?'), { target: { value: 'tetris' } })
      fireEvent.click(screen.getByText('Guess'))
      expect(screen.getByText(/repeat — max 10 pts/).textContent).toMatch(/Correct/)
    } finally {
      window.localStorage.removeItem('gameguesser.seenGames')
    }
  })

  it('silently resumes a stored round after reload', () => {
    render(<App />)
    fireEvent.click(screen.getByText('⚙ New game'))
    fireEvent.click(screen.getByText(/Start round \(10\)/))
    const before = screen.getByText(/Round game \d+ of 10/).textContent ?? ''
    const m = before.match(/Round game (\d+) of (\d+)/)
    expect(m).not.toBeNull()
    cleanup() // simulate reload: fresh mount, same sessionStorage
    render(<App />)
    // no click needed: straight back in the round at the same position
    expect(screen.getByText(new RegExp(`Round game ${m![1]} of ${m![2]}`))).toBeTruthy()
    expect(screen.queryByText(/Resume round/)).toBeNull()
  })

  it('lands on the summary when the stored round was already finished', () => {
    const results: Record<string, { solved: boolean; points: number; level: string; tries: number }> = {
      tetris: { solved: true, points: 500, level: '16×16', tries: 1 },
      doom: { solved: false, points: 0, level: 'Full', tries: 2 },
    }
    window.sessionStorage.setItem(
      'gameguesser.round',
      JSON.stringify({ v: 1, uid: 7, queue: ['tetris', 'doom'], results, gameId: 'doom', listName: null }),
    )
    // the original session recorded it before the refresh (same browser profile)
    window.localStorage.setItem(
      'gameguesser.roundHistory',
      JSON.stringify([{ date: '2026-10-05T00:00:00.000Z', label: 'Mixed pool', games: 2, solved: 1, points: 500 }]),
    )
    try {
      render(<App />)
      expect(screen.getByText('🏁 Round over!')).toBeTruthy()
      const hist = document.querySelector('.history')!
      expect(hist.textContent).toMatch(/1\/2 solved/)
      // resumed completion must not record a duplicate entry
      expect(hist.querySelectorAll('.roundrow').length).toBe(1)
    } finally {
      window.localStorage.removeItem('gameguesser.roundHistory')
    }
  })

  it('an explicit game link overrides a stored round', () => {
    window.sessionStorage.setItem(
      'gameguesser.round',
      JSON.stringify({ v: 1, queue: ['tetris', 'doom'], results: {}, gameId: 'tetris', listName: null }),
    )
    window.history.replaceState(null, '', '/?game=doom')
    try {
      render(<App />)
      expect(screen.queryByText(/Resume round/)).toBeNull()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('records finished rounds to history with a personal best', () => {
    render(<App />)
    fireEvent.click(screen.getByText('⚙ New game'))
    fireEvent.click(screen.getByText(/Start round \(10\)/))
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByText('Give up & reveal'))
      if (i < 9) fireEvent.click(screen.getByText(/Next in round/))
      else fireEvent.click(screen.getByText(/Round results/))
    }
    expect(screen.getByText('🏁 Round over!')).toBeTruthy()
    const hist = screen.getByText('🏆 Best & past rounds').closest('.history')!
    expect(hist.textContent).toMatch(/0\/10 solved/)
    expect(hist.textContent).toMatch(/Mixed pool/)
    fireEvent.click(screen.getByText('Free play'))
    fireEvent.click(screen.getByText('⚙ New game'))
    expect(screen.getByText(/Best round:/).textContent).toMatch(/0 pts/)
  })

  it('uses unique keys for siblings (same key duplicates/omits DOM nodes)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<App />)
      // play view, then setup view: every list-rendered collection mounts
      fireEvent.click(screen.getByText('⚙ New game'))
      fireEvent.click(screen.getByText(/Start round \(10\)/))
      fireEvent.click(screen.getByText('⚙ New game'))
      const dupes = err.mock.calls.filter((c) => String(c[0]).includes('same key'))
      expect(dupes).toEqual([])
    } finally {
      err.mockRestore()
    }
  })
})

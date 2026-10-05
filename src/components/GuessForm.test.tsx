// @vitest-environment jsdom
/** GuessForm: autocomplete opens while typing, dismisses on submit/pick/Escape. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import GuessForm from './GuessForm'

afterEach(() => {
  cleanup()
})

const type = (v: string) => {
  fireEvent.change(screen.getByPlaceholderText('Which game is this?'), { target: { value: v } })
}

describe('GuessForm', () => {
  it('shows the matched alias and picks the canonical title', () => {
    render(<GuessForm onSubmit={() => undefined} />)
    type('anno')
    const pick = screen.getByRole('button', { name: /Anno 1404 → Dawn of Discovery\(2009\)/i })
    fireEvent.click(pick)
    expect((screen.getByPlaceholderText('Which game is this?') as HTMLInputElement).value).toBe(
      'Dawn of Discovery (2009)',
    )
    expect(screen.queryByRole('button', { name: /Anno 1404/ })).toBeNull()
  })

  it('underlines only the typed substring of each suggestion', () => {
    render(<GuessForm onSubmit={() => undefined} />)
    type('anno')
    const underlined = screen.getAllByText('Anno', { selector: 'u.sug-match' })
    expect(underlined.length).toBeGreaterThan(0)
  })

  it('picks a plain title match the same way', () => {
    render(<GuessForm onSubmit={() => undefined} />)
    type('tetris')
    fireEvent.click(screen.getByRole('button', { name: /^Tetris\(1984\)$/ }))
    expect((screen.getByPlaceholderText('Which game is this?') as HTMLInputElement).value).toBe(
      'Tetris (1984)',
    )
  })

  it('dismisses the dropdown on submit and reopens on further edits', () => {
    const onSubmit = vi.fn()
    render(<GuessForm onSubmit={onSubmit} />)
    type('mario')
    expect(screen.getAllByRole('button', { name: /mario/i }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Guess'))
    expect(onSubmit).toHaveBeenCalledWith('mario')
    expect(screen.queryByRole('button', { name: /mario/i })).toBeNull()
    type('mario ')
    expect(screen.getAllByRole('button', { name: /mario/i }).length).toBeGreaterThan(0)
  })

  it('dismisses the dropdown on Escape', () => {
    render(<GuessForm onSubmit={() => undefined} />)
    type('doom')
    expect(screen.getAllByRole('button', { name: /doom/i }).length).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByPlaceholderText('Which game is this?'), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /doom/i })).toBeNull()
  })
})

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
  it('shows suggestions while typing and fills the input on pick', () => {
    render(<GuessForm onSubmit={() => undefined} />)
    type('zelda')
    const pick = screen.getAllByRole('button', { name: /zelda/i })[0]
    fireEvent.click(pick)
    expect((screen.getByPlaceholderText('Which game is this?') as HTMLInputElement).value).toMatch(/zelda/i)
    // picked: dropdown closes so it never covers the result message
    expect(screen.queryByRole('button', { name: /zelda/i })).toBeNull()
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

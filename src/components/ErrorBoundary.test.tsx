// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders a recovery screen instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('😵 Something broke')).toBeTruthy()
    expect(screen.getByText('Reload the game')).toBeTruthy()
    fireEvent.click(screen.getByText('Reload the game'))
  })
})

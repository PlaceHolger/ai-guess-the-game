import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import GuessSuggestions from './GuessSuggestions'
import { GAMES, getGame } from '../data/games'
import { suggestMatches } from '../lib/fuzzy'

interface Props {
  /** called with the raw input when the player submits */
  onSubmit: (value: string) => void
  /** level actions (reveal / hint buttons) rendered inside the form row */
  actions?: ReactNode
  /** increments on every wrong guess: the Guess button shakes once */
  shakeKey?: number
}

/**
 * Guess input with autocomplete. Owns its keystroke state so typing never
 * re-renders the whole App (canvas effect churn, pool recompute). Remounts
 * per game via key, which also clears the input for the next level. The
 * dropdown dismisses on submit/pick/Escape so it never covers the result
 * message and buttons below; any further edit reopens it.
 */
export default function GuessForm({ onSubmit, actions, shakeKey = 0 }: Props) {
  const [value, setValue] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [shaking, setShaking] = useState(false)
  // shake only when the key advances post-mount (a remount reuses the
  // current value and must not shake on its own)
  const prevKey = useRef(shakeKey)
  useEffect(() => {
    if (shakeKey !== prevKey.current) {
      prevKey.current = shakeKey
      if (shakeKey > 0) setShaking(true)
    }
  }, [shakeKey])
  // Suggestions only; submit stays free-text (the fuzzy matcher still
  // handles typos and regional names the list can't spell).
  const suggestions = useMemo(
    () => (dismissed ? [] : suggestMatches(GAMES, value)),
    [value, dismissed],
  )

  return (
    <div className="guesswrap">
      <form
        className="guessrow"
        onSubmit={(e) => {
          e.preventDefault()
          setDismissed(true)
          onSubmit(value)
        }}
      >
        <div className="guessfield">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setDismissed(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDismissed(true)
            }}
            placeholder="Which game is this?"
            autoFocus
            autoComplete="off"
          />
          <GuessSuggestions
            suggestions={suggestions}
            query={value}
            onPick={(id) => {
              const picked = getGame(id)
              if (picked) {
                // canonical "Title (year)": always an exact, solvable pick
                setValue(`${picked.title} (${picked.year})`)
                setDismissed(true)
              }
            }}
          />
        </div>
        <button
          type="submit"
          className={`primary${shaking ? ' shake' : ''}`}
          onAnimationEnd={() => setShaking(false)}
        >
          Guess
        </button>
        {actions}
      </form>
    </div>
  )
}

import type { GameEntry } from '../data/games'

interface Props {
  suggestions: GameEntry[]
  onPick: (title: string) => void
}

/** Autocomplete dropdown under the guess box: suggestions only, submit
 *  stays free-text (the fuzzy matcher handles typos the list can't spell).
 */
export default function GuessSuggestions({ suggestions, onPick }: Props) {
  if (suggestions.length === 0) return null
  return (
    <div className="gamelist">
      {suggestions.map((s) => (
        <button key={s.id} type="button" onClick={() => onPick(s.title)}>
          {s.title} <span className="muted">({s.year})</span>
        </button>
      ))}
    </div>
  )
}

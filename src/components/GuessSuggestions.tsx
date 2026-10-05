import type { ReactNode } from 'react'
import type { Suggestion } from '../lib/fuzzy'

interface Props {
  suggestions: Suggestion[]
  /** current input; its occurrence in each row is underlined */
  query: string
  /** receives the picked game's id; callers resolve the display/submit text */
  onPick: (id: string) => void
}

/** Autocomplete dropdown under the guess box: suggestions only, submit
 *  stays free-text (the fuzzy matcher handles typos the list can't spell).
 *  Titles render purple with only the typed part underlined; the year stays
 *  plain text.
 */
export default function GuessSuggestions({ suggestions, query, onPick }: Props) {
  if (suggestions.length === 0) return null
  const needle = query.trim()
  const hi = (text: string): ReactNode => {
    const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1
    if (at < 0) return text
    return (
      <>
        {text.slice(0, at)}
        <u className="sug-match">{text.slice(at, at + needle.length)}</u>
        {text.slice(at + needle.length)}
      </>
    )
  }
  return (
    <div className="gamelist">
      {suggestions.map((s) => {
        const yearAt = s.label.search(/ \(\d{4}\)$/)
        const title = yearAt >= 0 ? s.label.slice(0, yearAt) : s.label
        const year = yearAt >= 0 ? s.label.slice(yearAt) : ''
        return (
          <button key={s.game.id} type="button" onClick={() => onPick(s.game.id)}>
            <span className="sug-title">{hi(title)}</span>
            <span className="sug-year">{hi(year)}</span>
          </button>
        )
      })}
    </div>
  )
}

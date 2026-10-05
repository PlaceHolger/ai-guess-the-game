import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: boolean
}

/** Last-resort catch for render throws: blank page loses the round, this
 *  keeps score persistence (localStorage writes already happened) and offers
 *  a way back. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: false }

  static getDerivedStateFromError(): State {
    return { error: true }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="page">
          <main className="card">
            <h2>😵 Something broke</h2>
            <p className="muted">The game hit an error it couldn't recover from — your saved score is safe.</p>
            <button className="primary" onClick={() => window.location.reload()}>
              Reload the game
            </button>
          </main>
        </div>
      )
    }
    return this.props.children
  }
}

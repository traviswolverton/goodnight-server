import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function ErrorPanel({ error, reset }: { error?: unknown; reset?: () => void }) {
  return (
    <div role="alert" className="mx-auto grid max-w-md gap-3 py-16 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error && error.message ? error.message : 'An unexpected error occurred.'}
      </p>
      <div className="flex justify-center gap-2">
        {reset && (
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        )}
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </div>
  )
}

interface State {
  error: unknown
  failed: boolean
}

/** Last line of defence: a render error in one page shows a message instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('UI error:', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <ErrorPanel error={this.state.error} reset={() => this.setState({ error: null, failed: false })} />
    }
    return this.props.children
  }
}

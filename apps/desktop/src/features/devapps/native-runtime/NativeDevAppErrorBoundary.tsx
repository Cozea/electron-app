import { Component, type ErrorInfo, type ReactNode } from "react"

interface NativeDevAppErrorBoundaryProps {
  resetKey: string
  fallback: (error: Error) => ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface NativeDevAppErrorBoundaryState {
  error: Error | null
}

export class NativeDevAppErrorBoundary extends Component<
  NativeDevAppErrorBoundaryProps,
  NativeDevAppErrorBoundaryState
> {
  state: NativeDevAppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): NativeDevAppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  componentDidUpdate(previousProps: NativeDevAppErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}

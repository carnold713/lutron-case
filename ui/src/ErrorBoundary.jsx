import { Component } from 'react'

// Catches render errors below it and shows `fallback` (default: nothing).
// Used per-section so one bad section disappears instead of taking the page
// with it, and once at the root with a reload as a last resort.
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[ui] render error', error)
    if (this.props.reloadAfterMs) {
      setTimeout(() => window.location.reload(), this.props.reloadAfterMs)
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}

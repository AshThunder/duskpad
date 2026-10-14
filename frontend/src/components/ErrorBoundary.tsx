// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { Component, type ReactNode } from 'react';

/** Keeps one broken page from blanking the whole app; the error is shown and the page can be retried. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  componentDidCatch(error: Error) { console.error('page error', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-4" role="alert">
        <h1 className="font-display text-[26px] font-bold">Something went wrong on this page</h1>
        <pre className="panel p-4 text-[12px] whitespace-pre-wrap">{this.state.error.message}</pre>
        <button className="btn-dark" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

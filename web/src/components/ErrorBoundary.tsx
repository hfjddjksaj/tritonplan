import { Component, type ReactNode } from 'react';
import { nav } from '../lib/nav';
import { AuthCard } from './auth/AuthCard';

/**
 * The planner's last line: without it a render error (most likely a code-split
 * chunk that a deploy replaced while this tab stayed open) unmounts everything
 * and leaves a blank page. A reload fetches the current build and the account.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <AuthCard heading="Something went wrong. Reload to continue.">
        <button type="button" className="btn btn--primary auth__wide" onClick={() => nav.reload()}>
          Reload
        </button>
      </AuthCard>
    );
  }
}

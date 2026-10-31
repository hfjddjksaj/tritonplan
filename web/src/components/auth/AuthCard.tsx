/** The frame every signed-out screen shares: brand, heading, then the screen's own content. */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { PRODUCT_NAME } from '../../lib/brand';
import { Trident, X } from '../icons';

/** The card as a dialog over a page (the signed-out planner) instead of a page of its own. */
export interface AuthDialog {
  onClose: () => void;
  /** Fade in a moment after the page, so the visitor first sees where they are. */
  delayed: boolean;
}

function Brand() {
  return (
    <div className="brand auth__brand">
      <Trident className="brand__mark" size={22} />
      <span>{PRODUCT_NAME}</span>
    </div>
  );
}

export function AuthCard({ heading, children, dialog }: { heading: string; children?: ReactNode; dialog?: AuthDialog }) {
  if (dialog) return <AuthCardDialog heading={heading} dialog={dialog}>{children}</AuthCardDialog>;
  return (
    <main className="auth">
      <div className="auth__card">
        <Brand />
        <h1 className="auth__title">{heading}</h1>
        {children}
      </div>
    </main>
  );
}

function AuthCardDialog({ heading, children, dialog }: { heading: string; children?: ReactNode; dialog: AuthDialog }) {
  useEscapeKey(dialog.onClose);
  const titleId = useId();
  return (
    <div className={`authdlg${dialog.delayed ? ' authdlg--delayed' : ''}`} onClick={dialog.onClose}>
      <div
        className="auth__card authdlg__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={dialog.onClose} aria-label="Close">
          <X size={14} />
        </button>
        <Brand />
        {/* The page under the dialog has its own h1. */}
        <h2 id={titleId} className="auth__title">{heading}</h2>
        {children}
      </div>
    </div>
  );
}

export function AuthField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="auth__field">
      <span className="auth__label">{label}</span>
      <input className="auth__input" required {...input} />
    </label>
  );
}

/** A server answer or notice under the heading. Errors interrupt (alert); notices don't. */
export function AuthMessage({ tone, children }: { tone: 'notice' | 'error'; children: ReactNode }) {
  return (
    <p className={`auth__msg auth__msg--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

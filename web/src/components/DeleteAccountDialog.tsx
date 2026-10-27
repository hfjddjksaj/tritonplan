import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { apiDelete, type Me } from '../lib/cloud/api';
import { nav } from '../lib/nav';
import { clearPendingMigration } from '../lib/migration';
import { clearReceived } from '../lib/storage';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { AuthField } from './auth/AuthCard';
import { failureText } from './auth/copy';

/** Typing the address is the speed bump; the server checks it again. */
export function DeleteAccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  useEscapeKey(onClose);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === me.email.trim().toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !matches) return;
    setBusy(true);
    setError(null);
    const r = await apiDelete('/api/account', { confirmEmail: typed.trim() });
    if (r.ok) {
      // As at sign-out: on a shared browser the next person must not inherit these.
      clearPendingMigration();
      clearReceived();
      nav.assign('/'); // stays busy: the page is leaving
      return;
    }
    setError(failureText(r));
    setBusy(false);
  }

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop acctdlg"
        role="dialog"
        aria-modal="true"
        aria-label="Delete account"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">Delete account</h2>
        <p className="planpick__sub">This deletes your account and every plan in it. It can't be undone.</p>
        <form className="auth__form" onSubmit={submit}>
          <AuthField
            label={`Type ${me.email} to confirm`}
            type="email"
            name="confirmEmail"
            autoComplete="off"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {error && (
            <p className="auth__msg auth__msg--error" role="alert">
              {error}
            </p>
          )}
          <div className="acctdlg__actions">
            <button type="button" className="btn btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--sm acctdlg__danger" disabled={busy || !matches}>
              Delete account
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { apiPost } from '../lib/cloud/api';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { AuthField } from './auth/AuthCard';
import { failureText, PASSWORDS_DIFFER } from './auth/copy';

interface Props {
  onClose: () => void;
  onFlash: (msg: string) => void;
}

/**
 * Portaled to <body> like PlanPickerModal: the topbar is a positioned ancestor,
 * and a fixed overlay inside it would be constrained by it. Only offered to an
 * account that has a password: the server requires the current one, and a
 * Google-only account sets its first through the emailed link ("Set a password").
 */
export function ChangePasswordDialog({ onClose, onFlash }: Props) {
  useEscapeKey(onClose);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError(PASSWORDS_DIFFER);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await apiPost('/api/account/password', { current, next });
    if (r.ok) {
      onFlash('Password changed.');
      onClose();
      return;
    }
    setError(failureText(r, { 401: 'Your current password is wrong.' }));
    setBusy(false);
  }

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop acctdlg"
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">Change password</h2>
        <form className="auth__form" onSubmit={submit}>
          <AuthField
            label="Current password"
            type="password"
            name="current"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <AuthField
            label="New password"
            type="password"
            name="next"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <AuthField
            label="Confirm new password"
            type="password"
            name="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
            <button type="submit" className="btn btn--sm btn--primary" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

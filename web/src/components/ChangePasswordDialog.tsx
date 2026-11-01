import { useState, type FormEvent } from 'react';
import { apiPost } from '../lib/cloud/api';
import { Dialog } from './Dialog';
import { Field, Message } from './Field';
import { failureText, PASSWORDS_DIFFER } from './auth/copy';

interface Props {
  onClose: () => void;
  onFlash: (msg: string) => void;
}

/**
 * Only offered to an account that has a password: the server requires the current
 * one, and a Google-only account sets its first through the emailed link ("Set a password").
 */
export function ChangePasswordDialog({ onClose, onFlash }: Props) {
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

  return (
    <Dialog label="Change password" onClose={onClose} eyebrow="Account" title="Change password">
      <form className="fields" onSubmit={submit}>
        <Field
          label="Current password"
          type="password"
          name="current"
          autoComplete="current-password"
          autoFocus
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          name="next"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Field
          label="Confirm new password"
          type="password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <Message tone="error">{error}</Message>}
        <div className="mappop__actions">
          <button type="submit" className="btn btn--sm btn--primary" disabled={busy}>
            Save
          </button>
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

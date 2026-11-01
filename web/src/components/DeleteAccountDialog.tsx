import { useState, type FormEvent } from 'react';
import { apiDelete, type Me } from '../lib/cloud/api';
import { nav } from '../lib/nav';
import { clearPendingMigration } from '../lib/migration';
import { clearReceived } from '../lib/storage';
import { Dialog } from './Dialog';
import { Field, Message } from './Field';
import { WarnTriangle } from './icons';
import { failureText } from './auth/copy';

/** Typing the address is the speed bump; the server checks it again. */
export function DeleteAccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
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

  return (
    <Dialog label="Delete account" onClose={onClose} eyebrow="Account" title="Delete account">
      <p className="callout callout--danger callout--note">
        <WarnTriangle size={14} />
        <span>This deletes your account, every plan in it, your shared links and your calendar link. It can't be undone.</span>
      </p>
      <form className="fields" onSubmit={submit}>
        <Field
          label={
            <>
              Type <span className="field__nocaps mono">{me.email}</span> to confirm
            </>
          }
          type="email"
          name="confirmEmail"
          autoComplete="off"
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        {error && <Message tone="error">{error}</Message>}
        <div className="mappop__actions">
          <button type="submit" className="btn btn--sm btn--danger" disabled={busy || !matches}>
            Delete account
          </button>
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

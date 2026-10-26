/**
 * The body of an emailed-link screen: one password, posted with the link's
 * token. Success means the server started a session, so the page reloads into
 * the planner. Only the token comes from the URL — never a password.
 */
import { useState, type FormEvent } from 'react';
import { apiPost } from '../../lib/cloud/api';
import { nav } from '../../lib/nav';
import { AuthField, AuthMessage } from './AuthCard';
import { failureText } from './copy';

export function TokenPasswordForm({
  endpoint,
  token,
  submitLabel,
  autoComplete,
  byStatus,
}: {
  endpoint: string;
  token: string;
  submitLabel: string;
  autoComplete: 'new-password' | 'current-password';
  byStatus?: Readonly<Partial<Record<number, string>>>;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await apiPost(endpoint, { token, password });
    if (r.ok) {
      nav.assign('/'); // stays busy: the page is leaving
      return;
    }
    setError(failureText(r, byStatus));
    setBusy(false);
  }

  return (
    <>
      <form className="auth__form" onSubmit={submit}>
        <AuthField
          label="Password"
          type="password"
          name="password"
          autoComplete={autoComplete}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <AuthMessage tone="error">{error}</AuthMessage>}
        <button type="submit" className="btn btn--primary auth__wide" disabled={busy}>
          {submitLabel}
        </button>
      </form>
      <div className="auth__switch">
        <a className="auth__link" href="/">
          Back to sign in
        </a>
      </div>
    </>
  );
}

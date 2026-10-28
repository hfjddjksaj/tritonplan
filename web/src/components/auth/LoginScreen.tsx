/**
 * Sign in, sign up, or ask for a reset link. Every success that creates a
 * session leaves the page (returnTo), so the planner always boots fresh from
 * the server; sign-up and reset requests end on a "check your inbox" screen.
 */
import { useState, type FormEvent } from 'react';
import { apiPost } from '../../lib/cloud/api';
import { nav } from '../../lib/nav';
import { safeReturnTo } from '../../lib/site';
import { AuthCard, AuthField, AuthMessage, type AuthDialog } from './AuthCard';
import {
  CHECK_SPAM_NOTE, failureText, isUcsdAddress, PASSWORDS_DIFFER, UCSD_CHECK_NOTE, UCSD_MAIL_NOTE, WRONG_CREDENTIALS,
} from './copy';

type Mode = 'signin' | 'signup' | 'forgot' | 'check-email';

const LEDE = 'TritonPlan saves your plans to your account, so they follow you to any device.';

export function LoginScreen({
  notice,
  heading,
  returnTo,
  dialog,
}: {
  notice?: string;
  heading?: string;
  returnTo: string;
  /** Shown over the signed-out planner rather than as a page. */
  dialog?: AuthDialog;
}) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The address a correct sign-in found unconfirmed: offers to resend its link.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [sentText, setSentText] = useState('');
  const [sentTo, setSentTo] = useState('');
  // A redirect's notice explains how the student got here; it goes once they act.
  const [showNotice, setShowNotice] = useState(true);

  const addr = email.trim();
  const target = safeReturnTo(returnTo);

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setUnconfirmed(null);
    setShowNotice(false);
  };
  const checkEmail = (text: string, to: string) => {
    setSentText(text);
    setSentTo(to);
    go('check-email');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setUnconfirmed(null);
    setShowNotice(false);
    if (mode === 'signin') {
      const r = await apiPost('/api/auth/login', { email: addr, password });
      if (r.ok) {
        nav.assign(target); // stays busy: the page is leaving
        return;
      }
      if (r.status === 403) setUnconfirmed(addr);
      else setError(failureText(r, { 401: WRONG_CREDENTIALS }));
    } else if (mode === 'signup') {
      if (password !== confirm) {
        setError(PASSWORDS_DIFFER);
      } else {
        const r = await apiPost('/api/auth/signup', { email: addr, password });
        if (r.ok) checkEmail(`Check your inbox at ${addr} to confirm your account.`, addr);
        else setError(failureText(r));
      }
    } else if (mode === 'forgot') {
      const r = await apiPost('/api/auth/forgot', { email: addr });
      if (r.ok) checkEmail(`If an account exists for ${addr}, a reset link is on its way.`, addr);
      else setError(failureText(r));
    }
    setBusy(false);
  }

  async function resend() {
    if (busy || !unconfirmed) return;
    setBusy(true);
    const r = await apiPost('/api/auth/resend', { email: unconfirmed });
    if (r.ok) checkEmail(`Check your inbox at ${unconfirmed} to confirm your account.`, unconfirmed);
    else setError(failureText(r));
    setBusy(false);
  }

  if (mode === 'check-email') {
    return (
      <AuthCard heading="Check your email" dialog={dialog}>
        <AuthMessage tone="notice">{sentText}</AuthMessage>
        <p className="auth__lede">{isUcsdAddress(sentTo) ? UCSD_CHECK_NOTE : CHECK_SPAM_NOTE}</p>
        <button type="button" className="btn auth__wide" onClick={() => go('signin')}>
          Back to sign in
        </button>
      </AuthCard>
    );
  }

  const title =
    mode === 'forgot' ? 'Reset your password'
    : (heading ?? (mode === 'signup' ? 'Create your TritonPlan account' : 'Sign in to TritonPlan'));

  return (
    <AuthCard heading={title} dialog={dialog}>
      {notice && showNotice && <AuthMessage tone="notice">{notice}</AuthMessage>}
      {mode === 'forgot' ? (
        <p className="auth__lede">Enter your email and we'll send you a link to choose a new password.</p>
      ) : (
        <>
          <p className="auth__lede">{LEDE}</p>
          <a className="btn auth__wide auth__google" href={'/api/auth/google?returnTo=' + encodeURIComponent(target)}>
            <GoogleMark />
            Continue with Google
          </a>
          <div className="auth__or">or</div>
        </>
      )}

      <form className="auth__form" onSubmit={submit}>
        <AuthField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode === 'signup' && isUcsdAddress(addr) && <AuthMessage tone="notice">{UCSD_MAIL_NOTE}</AuthMessage>}
        {mode !== 'forgot' && (
          <AuthField
            label="Password"
            type="password"
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {mode === 'signup' && (
          <AuthField
            label="Confirm password"
            type="password"
            name="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        {error && <AuthMessage tone="error">{error}</AuthMessage>}
        {unconfirmed && (
          <AuthMessage tone="error">
            Confirm your email first — we sent a link to {unconfirmed}.{' '}
            <button type="button" className="auth__link" onClick={resend} disabled={busy}>
              Resend link
            </button>
          </AuthMessage>
        )}
        <button type="submit" className="btn btn--primary auth__wide" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>

      <div className="auth__switch">
        {mode === 'signin' && (
          <>
            <button type="button" className="auth__link" onClick={() => go('forgot')}>
              Forgot password?
            </button>
            <button type="button" className="auth__link" onClick={() => go('signup')}>
              Create an account
            </button>
          </>
        )}
        {mode === 'signup' && (
          <span>
            Already have an account?{' '}
            <button type="button" className="auth__link" onClick={() => go('signin')}>
              Sign in
            </button>
          </span>
        )}
        {mode === 'forgot' && (
          <button type="button" className="auth__link" onClick={() => go('signin')}>
            Back to sign in
          </button>
        )}
      </div>
    </AuthCard>
  );
}

/** Google's "G", in its own colours, as its sign-in branding asks. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

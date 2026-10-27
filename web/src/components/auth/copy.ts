/** Fixed wording for the sign-in screens, and how a failed auth call reads. */
import type { ApiResult } from '../../lib/cloud/api';
import { pluralize } from '../../lib/format';

export const LINK_EXPIRED = 'That link has expired or was already used. Sign in, or request a new one.';
export const WRONG_CREDENTIALS = 'Wrong email or password.';
export const VERIFY_MISMATCH =
  "That password doesn't match this sign-up. If you didn't sign up for TritonPlan, you can ignore the email.";
export const SOMETHING_WRONG = 'Something went wrong. Please try again.';

/** `?auth=` codes the server redirects back with. */
export const AUTH_NOTICES: ReadonlyMap<string, string> = new Map([
  ['link-expired', LINK_EXPIRED],
  ['google-failed', "Google sign-in didn't finish. Please try again."],
  ['google-unverified', "Your Google account's email isn't verified, so it can't be used to sign in."],
  ['google-unsupported', "Google can't confirm this email address for us. Sign in with your email and password instead."],
]);

// A Map, not an object literal: the error code comes off the wire.
const BY_ERROR: ReadonlyMap<string, string> = new Map([
  ['email_taken', 'An account with this email already exists. Sign in, or reset your password.'],
  ['weak_password', 'Use at least 8 characters.'],
  ['invalid_email', 'Enter a valid email address.'],
  ['link_expired', LINK_EXPIRED],
  ['mail_failed', "We couldn't send the confirmation email right now. Try again in a few minutes, or continue with Google."],
]);

export function tooManyAttempts(retryAfterSec: number | undefined): string {
  const n = Math.max(1, Math.ceil((retryAfterSec ?? 60) / 60));
  return `Too many attempts. Try again in ${n} ${pluralize(n, 'minute')}.`;
}

/** 429 → wait; then the caller's per-status wording; then the server's error code; else the generic line. */
export function failureText(
  r: Extract<ApiResult, { ok: false }>,
  byStatus: Readonly<Partial<Record<number, string>>> = {},
): string {
  if (r.status === 429) return tooManyAttempts(r.retryAfter);
  return byStatus[r.status] ?? BY_ERROR.get(r.error) ?? SOMETHING_WRONG;
}

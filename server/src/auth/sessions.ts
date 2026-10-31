import type { Config } from '../config';
import type { Db } from '../db/db';
import { randomToken, sha256Hex } from './tokens';

export const SESSION_COOKIE = 'tp_session';

const DAY_MS = 86_400_000;
const LIFETIME_MS = 30 * DAY_MS;
const REFRESH_BELOW_MS = 29 * DAY_MS; // refresh at most about once a day, not on every request

export function createSession(db: Db, userId: string, now: Date): string {
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256Hex(token),
    userId,
    now.toISOString(),
    new Date(now.getTime() + LIFETIME_MS).toISOString(),
  );
  return token;
}

export function readSession(db: Db, token: string, now: Date): { userId: string; refreshed: boolean } | null {
  const hash = sha256Hex(token);
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hash) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return null;
  const left = Date.parse(row.expires_at) - now.getTime();
  if (!(left > 0)) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  if (left < REFRESH_BELOW_MS) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(now.getTime() + LIFETIME_MS).toISOString(), hash);
    return { userId: row.user_id, refreshed: true };
  }
  return { userId: row.user_id, refreshed: false };
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(token));
}

/** Drop all of a user's sessions (password change/reset), optionally keeping the caller's own. */
export function deleteUserSessions(db: Db, userId: string, exceptToken?: string): void {
  if (exceptToken === undefined) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha256Hex(exceptToken));
  }
}

function cookie(value: string, maxAge: number, cfg: Config): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, cfg: Config): string {
  return cookie(token, LIFETIME_MS / 1000, cfg);
}

export function clearSessionCookie(cfg: Config): string {
  return cookie('', 0, cfg);
}

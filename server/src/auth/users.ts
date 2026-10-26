import type { Db } from '../db/db';
import { newId, randomToken, sha256Hex } from './tokens';

export interface UserRow {
  id: string;
  email: string;
  email_verified: 0 | 1;
  password_hash: string | null;
  google_sub: string | null;
}

const COLS = 'id, email, email_verified, password_hash, google_sub';

export function findUserByEmail(db: Db, email: string): UserRow | undefined {
  return db.prepare(`SELECT ${COLS} FROM users WHERE email = ?`).get(email) as UserRow | undefined;
}

export function findUserById(db: Db, id: string): UserRow | undefined {
  return db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

export function createUser(
  db: Db,
  f: { email: string; verified: boolean; passwordHash?: string | null; googleSub?: string | null },
  now: Date,
): UserRow {
  const id = newId();
  db.prepare('INSERT INTO users (id, email, email_verified, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    f.email,
    f.verified ? 1 : 0,
    f.passwordHash ?? null,
    f.googleSub ?? null,
    now.toISOString(),
  );
  return findUserById(db, id)!;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The one place an address is canonicalised; every lookup and insert goes through it. */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const HOUR_MS = 3_600_000;

/** Single live token per user and kind: issuing a new one invalidates the previous link. Only the SHA-256 is stored. */
export function issueEmailToken(db: Db, userId: string, kind: 'verify' | 'reset', now: Date, pendingPasswordHash?: string): string {
  const token = randomToken();
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
  db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, pending_password_hash, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256Hex(token),
    userId,
    kind,
    pendingPasswordHash ?? null,
    new Date(now.getTime() + (kind === 'verify' ? 24 : 1) * HOUR_MS).toISOString(),
  );
  return token;
}

/** Looks up and deletes in one step so a link works once; returns null for unknown, wrong-kind or expired tokens. */
export function consumeEmailToken(
  db: Db,
  token: string,
  kind: 'verify' | 'reset',
  now: Date,
): { userId: string; pendingPasswordHash: string | null } | null {
  const hash = sha256Hex(token);
  const row = db.prepare('SELECT user_id, pending_password_hash, expires_at FROM email_tokens WHERE token_hash = ? AND kind = ?').get(hash, kind) as
    | { user_id: string; pending_password_hash: string | null; expires_at: string }
    | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').run(hash);
  if (!(Date.parse(row.expires_at) > now.getTime())) return null;
  return { userId: row.user_id, pendingPasswordHash: row.pending_password_hash };
}

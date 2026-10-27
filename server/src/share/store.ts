import { randomBytes } from 'node:crypto';
import { tx, type Db } from '../db/db';

export const MAX_SHARES_PER_USER = 500;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 10;
const MAX_INSERT_TRIES = 5;
// Largest multiple of 62 that fits in a byte: bytes at or above it are redrawn, because `% 62` on all 256
// values would make the first 8 symbols (256 mod 62 = 8) slightly likelier than the rest.
const UNBIASED_LIMIT = 248;

/** 10 base62 characters from the OS CSPRNG, ~59 bits: unguessable, so the code itself is the capability. */
export function newShareCode(): string {
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH * 2)) {
      if (b < UNBIASED_LIMIT && out.length < CODE_LENGTH) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export interface ShareRow { code: string; name: string; createdAt: string }

/** `gen` is injectable so a test can force collisions. Returns null when the user is at the cap. */
export function createShare(
  db: Db, userId: string, name: string, planJson: string, createdAt: string, gen: () => string = newShareCode,
): string | null {
  // The count and the insert share one write lock, so two racing requests cannot both slip under the cap.
  return tx(db, () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').get(userId) as { n: number };
    if (n >= MAX_SHARES_PER_USER) return null;
    const insert = db.prepare('INSERT OR IGNORE INTO shares (code, user_id, name, data, created_at) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < MAX_INSERT_TRIES; i++) {
      const code = gen();
      if (insert.run(code, userId, name, planJson, createdAt).changes === 1) return code;
    }
    throw new Error('share code collision limit reached');
  });
}

export function listShares(db: Db, userId: string): ShareRow[] {
  return db
    .prepare('SELECT code, name, created_at AS createdAt FROM shares WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(userId) as unknown as ShareRow[];
}

/** Scoped by owner: someone else's code deletes nothing. */
export function deleteShare(db: Db, userId: string, code: string): boolean {
  return Number(db.prepare('DELETE FROM shares WHERE code = ? AND user_id = ?').run(code, userId).changes) === 1;
}

/** Selects no user column on purpose: the public route can only leak what this returns. */
export function getShare(db: Db, code: string): { name: string; plan: unknown; createdAt: string } | null {
  const row = db.prepare('SELECT name, data, created_at AS createdAt FROM shares WHERE code = ?').get(code) as
    { name: string; data: string; createdAt: string } | undefined;
  return row ? { name: row.name, plan: JSON.parse(row.data), createdAt: row.createdAt } : null;
}

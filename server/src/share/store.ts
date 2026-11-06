import { randomBytes } from 'node:crypto';
import { applySelection, SHARED_PLAN_TTL_MS, type PlanState } from '@triton/shared';
import { tx, type Db } from '../db/db';

export const MAX_LIVE_SHARED_PER_USER = 50;
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

export interface SharedRow { code: string; name: string; termKey: string; createdAt: string; expiresAt: string }

/** `gen` is injectable so a test can force collisions. Returns null when the owner is at the live cap. */
export function createShared(
  db: Db, ownerId: string, name: string, termKey: string, planJson: string, now: Date, gen: () => string = newShareCode,
): { code: string; expiresAt: string } | null {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SHARED_PLAN_TTL_MS).toISOString();
  // The count and the insert share one write lock, so two racing requests cannot both slip under the cap.
  return tx(db, () => {
    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM shared_plans WHERE owner_id = ? AND expires_at > ?')
      .get(ownerId, createdAt) as { n: number };
    if (n >= MAX_LIVE_SHARED_PER_USER) return null;
    const insert = db.prepare(
      `INSERT OR IGNORE INTO shared_plans (code, owner_id, name, term_key, data, version, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    for (let i = 0; i < MAX_INSERT_TRIES; i++) {
      const code = gen();
      if (insert.run(code, ownerId, name, termKey, planJson, createdAt, expiresAt).changes === 1) return { code, expiresAt };
    }
    throw new Error('share code collision limit reached');
  });
}

export function listShared(db: Db, ownerId: string, now: Date): SharedRow[] {
  return db
    .prepare(
      `SELECT code, name, term_key AS termKey, created_at AS createdAt, expires_at AS expiresAt
       FROM shared_plans WHERE owner_id = ? AND expires_at > ? ORDER BY created_at DESC, rowid DESC`,
    )
    .all(ownerId, now.toISOString()) as unknown as SharedRow[];
}

/** Selects no owner column on purpose: the public route can only leak what this returns. */
export function readShared(
  db: Db, code: string, now: Date,
): { name: string; plan: PlanState; version: number; expiresAt: string } | null {
  const row = db
    .prepare('SELECT name, data, version, expires_at AS expiresAt FROM shared_plans WHERE code = ? AND expires_at > ?')
    .get(code, now.toISOString()) as { name: string; data: string; version: number; expiresAt: string } | undefined;
  return row ? { name: row.name, plan: JSON.parse(row.data) as PlanState, version: row.version, expiresAt: row.expiresAt } : null;
}

export function sharedVersion(db: Db, code: string, now: Date): number | null {
  const row = db.prepare('SELECT version FROM shared_plans WHERE code = ? AND expires_at > ?').get(code, now.toISOString()) as
    { version: number } | undefined;
  return row ? row.version : null;
}

/** Read, apply and write in one transaction so concurrent switches serialize and each bumps the version once. */
export function selectInShared(
  db: Db, code: string, courseId: string, optionId: string, now: Date,
): { version: number } | 'not-found' | 'invalid' {
  return tx(db, () => {
    const row = db.prepare('SELECT data, version FROM shared_plans WHERE code = ? AND expires_at > ?').get(code, now.toISOString()) as
      { data: string; version: number } | undefined;
    if (!row) return 'not-found';
    const next = applySelection(JSON.parse(row.data) as PlanState, courseId, optionId);
    if (!next) return 'invalid';
    const version = row.version + 1;
    db.prepare('UPDATE shared_plans SET data = ?, version = ? WHERE code = ?').run(JSON.stringify(next), version, code);
    return { version };
  });
}

export function sweepExpiredShared(db: Db, now: Date): number {
  return Number(db.prepare('DELETE FROM shared_plans WHERE expires_at <= ?').run(now.toISOString()).changes);
}

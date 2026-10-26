import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDb, tx } from './db';
import { MIGRATIONS } from './migrations';

test('migrations create every table and set user_version', () => {
  const db = openDb(':memory:');
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  for (const t of ['users', 'sessions', 'email_tokens', 'term_docs', 'plan_docs', 'pool_courses', 'user_docs']) {
    expect(names).toContain(t);
  }
  expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
});

test('reopening a file database does not re-run migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tp-db-'));
  try {
    const path = join(dir, 'a.db');
    const first = openDb(path);
    first.close();
    const second = openDb(path);
    expect(second.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
    expect(second.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tx commits on success and rolls back on throw', () => {
  const db = openDb(':memory:');
  const insert = () => db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.c', 'now')").run();
  expect(() => tx(db, () => { insert(); throw new Error('boom'); })).toThrow('boom');
  expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  expect(tx(db, () => { insert(); return 7; })).toBe(7);
  expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
});

import nodeModule from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

// Not a static import: Vite 5 / vitest 2 resolve 'node:sqlite' to an npm package
// named "sqlite" and fail. createRequire sidesteps their resolver. (Default import,
// not `{ createRequire }`: the bundle banner already declares that name.)
const { DatabaseSync: Database } = nodeModule.createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;`);
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = row.user_version; i < MIGRATIONS.length; i++) {
    // Each step and its version bump commit together, so a crash never leaves a half-applied schema.
    tx(db, () => {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

/** Run fn in an IMMEDIATE transaction (takes the write lock up front, so no mid-transaction SQLITE_BUSY upgrade). */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

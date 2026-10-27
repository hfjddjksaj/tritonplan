// Append-only: entry i takes PRAGMA user_version from i to i+1. Never edit a shipped entry.
export const MIGRATIONS: string[] = [
  `
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified INTEGER NOT NULL DEFAULT 0, password_hash TEXT, google_sub TEXT UNIQUE,
  created_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE email_tokens (token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
  pending_password_hash TEXT, expires_at TEXT NOT NULL);
CREATE TABLE term_docs (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_key TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, term_key));
CREATE TABLE plan_docs (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL, term_key TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY (user_id, plan_id));
CREATE TABLE pool_courses (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id));
CREATE TABLE user_docs (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind));
`,
  // Per-user monotonic counter for term/plan versions, so a delete + recreate never reuses a version a stale device still holds.
  `ALTER TABLE users ADD COLUMN version_seq INTEGER NOT NULL DEFAULT 0;`,
  // Snapshots are copies, not links into plan_docs: later edits or deletes of the owner's plan never change what a code opens.
  `
CREATE TABLE shares (code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX shares_by_user ON shares(user_id, created_at);
`,
];

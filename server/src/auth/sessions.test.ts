import { beforeEach, expect, test } from 'vitest';
import { openDb, type Db } from '../db/db';
import { testDeps } from '../test-helpers';
import { clearSessionCookie, createSession, deleteSession, deleteUserSessions, readSession, sessionCookie } from './sessions';

let db: Db;
const uid = 'u1';
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86400_000);
const count = () => (db.prepare('select count(*) n from sessions').get() as { n: number }).n;

beforeEach(() => {
  db = openDb(':memory:');
  for (const id of ['u1', 'u2']) {
    db.prepare('insert into users (id, email, created_at) values (?, ?, ?)').run(id, `${id}@x.com`, day(0).toISOString());
  }
});

test('session token is stored hashed, expires, and refreshes', () => {
  const t = createSession(db, uid, day(0));
  expect(JSON.stringify(db.prepare('select * from sessions').all())).not.toContain(t);
  expect(readSession(db, t, day(0))).toEqual({ userId: uid, refreshed: false });
  expect(readSession(db, t, day(2))?.refreshed).toBe(true);
  expect(readSession(db, t, day(33))).toBeNull();
});

test('expired session is deleted on read; unknown token is null', () => {
  const t = createSession(db, uid, day(0));
  expect(readSession(db, t, day(31))).toBeNull();
  expect(count()).toBe(0);
  expect(readSession(db, 'nope', day(0))).toBeNull();
});

test('refresh extends to a full 30 days from now', () => {
  const t = createSession(db, uid, day(0));
  readSession(db, t, day(2));
  const exp = (db.prepare('select expires_at e from sessions').get() as { e: string }).e;
  expect(exp).toBe(day(32).toISOString()); // day2 + 30
  expect(readSession(db, t, day(33))).toBeNull();
});

test('deleteSession and deleteUserSessions (with exception)', () => {
  const a = createSession(db, uid, day(0));
  const b = createSession(db, uid, day(0));
  const c = createSession(db, 'u2', day(0));
  deleteSession(db, a);
  expect(readSession(db, a, day(0))).toBeNull();
  deleteUserSessions(db, uid, b);
  expect(readSession(db, b, day(0))).not.toBeNull();
  deleteUserSessions(db, uid);
  expect(readSession(db, b, day(0))).toBeNull();
  expect(readSession(db, c, day(0))).not.toBeNull();
});

test('cookie attribute strings are exact', () => {
  const { config } = testDeps();
  expect(sessionCookie('tok', config)).toBe('tp_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure');
  expect(sessionCookie('tok', { ...config, cookieSecure: false })).toBe('tp_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000');
  expect(clearSessionCookie(config)).toBe('tp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure');
});

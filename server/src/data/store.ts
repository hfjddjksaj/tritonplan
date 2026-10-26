import type { ApptTimes, CourseOffering, StateSnapshot, SyncOp, SyncResponse, SyncVersions } from '@triton/shared';
import { tx, type Db } from '../db/db';

// Every statement below is scoped by user_id; there is deliberately no helper that takes a bare row id.

export function getSnapshot(db: Db, userId: string): StateSnapshot {
  const snap: StateSnapshot = { terms: {}, plans: {}, pool: [], appt: null };
  for (const r of db.prepare('SELECT term_key, version, data FROM term_docs WHERE user_id = ? ORDER BY term_key').all(userId) as { term_key: string; version: number; data: string }[]) {
    snap.terms[r.term_key] = { version: r.version, data: JSON.parse(r.data) };
  }
  for (const r of db.prepare('SELECT plan_id, term_key, version, data FROM plan_docs WHERE user_id = ? ORDER BY plan_id').all(userId) as { plan_id: string; term_key: string; version: number; data: string }[]) {
    snap.plans[r.plan_id] = { version: r.version, termKey: r.term_key, data: JSON.parse(r.data) };
  }
  for (const r of db.prepare('SELECT data FROM pool_courses WHERE user_id = ? ORDER BY course_id').all(userId) as { data: string }[]) {
    snap.pool.push(JSON.parse(r.data) as CourseOffering);
  }
  const appt = db.prepare(`SELECT data FROM user_docs WHERE user_id = ? AND kind = 'appt'`).get(userId) as { data: string } | undefined;
  if (appt) snap.appt = JSON.parse(appt.data) as ApptTimes[];
  return snap;
}

class Conflict extends Error {}

/** Applies the whole batch atomically; any version conflict rolls everything back and reports every conflicting row. */
export function applyOps(db: Db, userId: string, ops: SyncOp[], nowIso: string): SyncResponse {
  const versions: SyncVersions = { terms: {}, plans: {} };
  const conflicts: { kind: 'term' | 'plan'; id: string }[] = [];
  try {
    tx(db, () => {
      for (const op of ops) {
        switch (op.op) {
          case 'putTerm':
          case 'putPlan': {
            const isTerm = op.op === 'putTerm';
            const id = isTerm ? op.termKey : op.planId;
            const cur = currentVersion(db, userId, isTerm ? 'term' : 'plan', id);
            if (cur !== op.baseVersion) {
              conflicts.push({ kind: isTerm ? 'term' : 'plan', id });
              break;
            }
            const next = op.baseVersion + 1;
            const json = JSON.stringify(op.data);
            if (isTerm) {
              db.prepare(
                `INSERT INTO term_docs (user_id, term_key, version, data, updated_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (user_id, term_key) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
              ).run(userId, id, next, json, nowIso);
              versions.terms[id] = next;
            } else {
              db.prepare(
                `INSERT INTO plan_docs (user_id, plan_id, term_key, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (user_id, plan_id) DO UPDATE SET term_key = excluded.term_key, version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
              ).run(userId, id, op.termKey, next, json, nowIso);
              versions.plans[id] = next;
            }
            break;
          }
          case 'deleteTerm':
          case 'deletePlan': {
            const isTerm = op.op === 'deleteTerm';
            const id = isTerm ? op.termKey : op.planId;
            const cur = currentVersion(db, userId, isTerm ? 'term' : 'plan', id);
            // A missing row is success: the wanted end state already holds. No cascade; the client sends its own plan deletes.
            if (cur === 0) break;
            if (cur !== op.baseVersion) {
              conflicts.push({ kind: isTerm ? 'term' : 'plan', id });
              break;
            }
            if (isTerm) db.prepare('DELETE FROM term_docs WHERE user_id = ? AND term_key = ?').run(userId, id);
            else db.prepare('DELETE FROM plan_docs WHERE user_id = ? AND plan_id = ?').run(userId, id);
            break;
          }
          case 'putCourses':
            for (const c of op.courses) {
              db.prepare(
                `INSERT INTO pool_courses (user_id, course_id, data, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (user_id, course_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
              ).run(userId, c.id, JSON.stringify(c), nowIso);
            }
            break;
          case 'deleteCourses':
            for (const id of op.ids) db.prepare('DELETE FROM pool_courses WHERE user_id = ? AND course_id = ?').run(userId, id);
            break;
          case 'putAppt':
            db.prepare(
              `INSERT INTO user_docs (user_id, kind, data, updated_at) VALUES (?, 'appt', ?, ?)
               ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
            ).run(userId, JSON.stringify(op.data), nowIso);
            break;
        }
      }
      if (conflicts.length) throw new Conflict();
    });
  } catch (e) {
    if (e instanceof Conflict) return { ok: false, error: 'conflict', conflicts };
    throw e;
  }
  return { ok: true, versions };
}

function currentVersion(db: Db, userId: string, kind: 'term' | 'plan', id: string): number {
  const sql = kind === 'term'
    ? 'SELECT version FROM term_docs WHERE user_id = ? AND term_key = ?'
    : 'SELECT version FROM plan_docs WHERE user_id = ? AND plan_id = ?';
  const row = db.prepare(sql).get(userId, id) as { version: number } | undefined;
  return row?.version ?? 0;
}

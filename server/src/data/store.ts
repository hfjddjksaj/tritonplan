import type { ApptTimes, CourseOffering, StateSnapshot, SyncOp, SyncResponse, SyncVersions } from '@triton/shared';
import { tx, type Db } from '../db/db';

// Every statement below is scoped by user_id; there is deliberately no helper that takes a bare row id.

export function getSnapshot(db: Db, userId: string): StateSnapshot {
  // Null-prototype maps: keys come from clients, and a `__proto__` key must stay a plain entry.
  const snap: StateSnapshot = { terms: Object.create(null), plans: Object.create(null), pool: [], appt: null };
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

/** Serialized-JSON cache so a doc is stringified once for both the size check and the write. */
export type JsonCache = Map<unknown, string>;
export function docJson(v: unknown, cache: JsonCache): string {
  let j = cache.get(v);
  if (j === undefined) {
    j = JSON.stringify(v);
    cache.set(v, j);
  }
  return j;
}

/**
 * Applies the whole batch atomically; any version conflict rolls everything back and reports every conflicting row.
 * Versions come from a per-user counter (users.version_seq), not row+1, so a delete followed by a re-create can never
 * hand out a version that a stale device still holds.
 */
export function applyOps(db: Db, userId: string, ops: SyncOp[], nowIso: string, cache: JsonCache = new Map()): SyncResponse {
  const versions: SyncVersions = { terms: Object.create(null), plans: Object.create(null) };
  const conflicts: { kind: 'term' | 'plan'; id: string }[] = [];
  const seen = new Set<string>();
  const conflict = (kind: 'term' | 'plan', id: string) => {
    if (!seen.has(`${kind}:${id}`)) {
      seen.add(`${kind}:${id}`);
      conflicts.push({ kind, id });
    }
  };
  const q = {
    termVer: db.prepare('SELECT version FROM term_docs WHERE user_id = ? AND term_key = ?'),
    planVer: db.prepare('SELECT version FROM plan_docs WHERE user_id = ? AND plan_id = ?'),
    seq: db.prepare('UPDATE users SET version_seq = version_seq + 1 WHERE id = ? RETURNING version_seq'),
    putTerm: db.prepare(
      `INSERT INTO term_docs (user_id, term_key, version, data, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, term_key) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
    ),
    putPlan: db.prepare(
      `INSERT INTO plan_docs (user_id, plan_id, term_key, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, plan_id) DO UPDATE SET term_key = excluded.term_key, version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
    ),
    delTerm: db.prepare('DELETE FROM term_docs WHERE user_id = ? AND term_key = ?'),
    delPlan: db.prepare('DELETE FROM plan_docs WHERE user_id = ? AND plan_id = ?'),
    putCourse: db.prepare(
      `INSERT INTO pool_courses (user_id, course_id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, course_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ),
    delCourse: db.prepare('DELETE FROM pool_courses WHERE user_id = ? AND course_id = ?'),
    putAppt: db.prepare(
      `INSERT INTO user_docs (user_id, kind, data, updated_at) VALUES (?, 'appt', ?, ?)
       ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ),
  };
  const current = (isTerm: boolean, id: string): number =>
    ((isTerm ? q.termVer : q.planVer).get(userId, id) as { version: number } | undefined)?.version ?? 0;
  const nextVersion = (): number => (q.seq.get(userId) as { version_seq: number }).version_seq;

  try {
    tx(db, () => {
      for (const op of ops) {
        switch (op.op) {
          case 'putTerm':
          case 'putPlan': {
            const isTerm = op.op === 'putTerm';
            const id = isTerm ? op.termKey : op.planId;
            if (current(isTerm, id) !== op.baseVersion) {
              conflict(isTerm ? 'term' : 'plan', id);
              break;
            }
            const v = nextVersion();
            const json = docJson(op.data, cache);
            if (op.op === 'putTerm') {
              q.putTerm.run(userId, id, v, json, nowIso);
              versions.terms[id] = v;
            } else {
              q.putPlan.run(userId, id, op.termKey, v, json, nowIso);
              versions.plans[id] = v;
            }
            break;
          }
          case 'deleteTerm':
          case 'deletePlan': {
            const isTerm = op.op === 'deleteTerm';
            const id = isTerm ? op.termKey : op.planId;
            const cur = current(isTerm, id);
            // A missing row is success: the wanted end state already holds. No cascade; the client sends its own plan deletes.
            if (cur === 0) break;
            if (cur !== op.baseVersion) {
              conflict(isTerm ? 'term' : 'plan', id);
              break;
            }
            (isTerm ? q.delTerm : q.delPlan).run(userId, id);
            break;
          }
          case 'putCourses':
            for (const c of op.courses) q.putCourse.run(userId, c.id, docJson(c, cache), nowIso);
            break;
          case 'deleteCourses':
            for (const id of op.ids) q.delCourse.run(userId, id);
            break;
          case 'putAppt':
            q.putAppt.run(userId, docJson(op.data, cache), nowIso);
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

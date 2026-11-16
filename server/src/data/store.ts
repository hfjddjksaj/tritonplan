import { mergeApptTimes, SYNC_LIMITS } from '@triton/shared';
import type { ApptTimes, SyncOp, SyncResponse, SyncVersions } from '@triton/shared';
import { tx, type Db } from '../db/db';

// Every statement below is scoped by user_id; there is deliberately no helper that takes a bare row id.

/**
 * What GET /api/state answers with: a StateSnapshot, as JSON text. Every doc is stored as JSON already, so the
 * answer is put together from the stored text and reading an account parses nothing. Parsing each doc only to
 * serialize it again cost several times the account's size in memory, on the one thread that serves everyone.
 * A term key and a plan id are unique within an account, so no key of the two maps repeats.
 */
export function snapshotJson(db: Db, userId: string): string {
  const str = (s: string): string => JSON.stringify(s);
  const terms = (db.prepare('SELECT term_key, version, data FROM term_docs WHERE user_id = ? ORDER BY term_key').all(userId) as { term_key: string; version: number; data: string }[])
    .map((r) => `${str(r.term_key)}:{"version":${r.version},"data":${r.data}}`);
  const plans = (db.prepare('SELECT plan_id, term_key, version, data FROM plan_docs WHERE user_id = ? ORDER BY plan_id').all(userId) as { plan_id: string; term_key: string; version: number; data: string }[])
    .map((r) => `${str(r.plan_id)}:{"version":${r.version},"termKey":${str(r.term_key)},"data":${r.data}}`);
  const pool = (db.prepare('SELECT data FROM pool_courses WHERE user_id = ? ORDER BY course_id').all(userId) as { data: string }[])
    .map((r) => r.data);
  const appt = db.prepare(`SELECT data FROM user_docs WHERE user_id = ? AND kind = 'appt'`).get(userId) as { data: string } | undefined;
  return `{"terms":{${terms.join(',')}},"plans":{${plans.join(',')}},"pool":[${pool.join(',')}],"appt":${appt ? appt.data : 'null'}}`;
}

class Conflict extends Error {}
class AccountFull extends Error {}

/**
 * Charged per row on top of its doc and keys. A row costs the disk (the record, its index entry) and
 * GET /api/state (its key and framing, the parsed object) about this much however small the doc is, so without
 * it a million one-byte docs would count as one megabyte.
 */
const ROW_BYTES = 200;

export type SyncResult = SyncResponse | { ok: false; error: 'account_full' };

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
 *
 * An account stores at most maxAccountBytes, every kind of doc counted. Nothing else bounds how much one account
 * can write, and GET /api/state builds the whole of it in memory. A batch is refused, whole, when it leaves the
 * account over the cap and larger than it was: an account that is over (stored under a higher cap) can still
 * delete, shrink and edit in place.
 */
export function applyOps(
  db: Db, userId: string, ops: SyncOp[], nowIso: string, cache: JsonCache = new Map(),
  maxAccountBytes: number = SYNC_LIMITS.maxAccountBytes,
): SyncResult {
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
    getAppt: db.prepare(`SELECT data FROM user_docs WHERE user_id = ? AND kind = 'appt'`),
    putAppt: db.prepare(
      `INSERT INTO user_docs (user_id, kind, data, updated_at) VALUES (?, 'appt', ?, ?)
       ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ),
    // A row is charged its doc, its keys and ROW_BYTES. octet_length reads a size from the row's header, not its content.
    stored: db.prepare(
      `SELECT (SELECT COALESCE(SUM(octet_length(data) + octet_length(term_key) + ${ROW_BYTES}), 0) FROM term_docs WHERE user_id = ?1)
            + (SELECT COALESCE(SUM(octet_length(data) + octet_length(plan_id) + octet_length(term_key) + ${ROW_BYTES}), 0) FROM plan_docs WHERE user_id = ?1)
            + (SELECT COALESCE(SUM(octet_length(data) + octet_length(course_id) + ${ROW_BYTES}), 0) FROM pool_courses WHERE user_id = ?1)
            + (SELECT COALESCE(SUM(octet_length(data) + octet_length(kind) + ${ROW_BYTES}), 0) FROM user_docs WHERE user_id = ?1) AS bytes`,
    ),
  };
  const stored = (): number => (q.stored.get(userId) as { bytes: number }).bytes;
  // Only a batch that stores something can grow the account; a batch of deletes is never measured.
  const stores = ops.some((op) => op.op === 'putTerm' || op.op === 'putPlan' || op.op === 'putCourses' || op.op === 'putAppt');
  const current = (isTerm: boolean, id: string): number =>
    ((isTerm ? q.termVer : q.planVer).get(userId, id) as { version: number } | undefined)?.version ?? 0;
  const nextVersion = (): number => (q.seq.get(userId) as { version_seq: number }).version_seq;

  try {
    tx(db, () => {
      const before = stores ? stored() : 0;
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
          case 'putAppt': {
            // Devices capture different terms: merge per term, newer capture wins.
            const row = q.getAppt.get(userId) as { data: string } | undefined;
            const data = row ? mergeApptTimes(JSON.parse(row.data) as ApptTimes[], op.data) : op.data;
            q.putAppt.run(userId, docJson(data, cache), nowIso);
            break;
          }
        }
      }
      if (conflicts.length) throw new Conflict();
      if (stores) {
        const after = stored();
        if (after > maxAccountBytes && after > before) throw new AccountFull();
      }
    });
  } catch (e) {
    if (e instanceof Conflict) return { ok: false, error: 'conflict', conflicts };
    if (e instanceof AccountFull) return { ok: false, error: 'account_full' };
    throw e;
  }
  return { ok: true, versions };
}

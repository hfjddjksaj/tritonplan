/**
 * Pure diff of the desired in-memory state against what the server last
 * acknowledged, producing sync ops. Records are compared by the exact JSON
 * that would be sent. Versions are opaque: only ever read from the server.
 */
import type { ApptTimes, CourseOffering, SyncOp, SyncVersions } from '@triton/shared';
import type { TermKey } from '../terms';
import type { TermsState } from '../terms-state';
import { splitTerms, type WebSnapshot } from './records';

export interface Acked {
  terms: Map<TermKey, { version: number; json: string }>;
  plans: Map<string, { version: number; termKey: TermKey; json: string }>;
  pool: Map<string, string>;
  appt: string | null;
}
export interface Desired { terms: TermsState | null; pool: CourseOffering[]; appt: ApptTimes[] | null }

export function ackedFromSnapshot(s: WebSnapshot): Acked {
  return {
    terms: new Map(Object.entries(s.terms).map(([k, v]) => [k, { version: v.version, json: JSON.stringify(v.data) }])),
    plans: new Map(Object.entries(s.plans).map(([k, v]) => [k, { version: v.version, termKey: v.termKey, json: JSON.stringify(v.data) }])),
    pool: new Map(s.pool.map((c) => [c.id, JSON.stringify(c)])),
    appt: s.appt === null ? null : JSON.stringify(s.appt),
  };
}

/** Order: putTerm, putPlan, deletePlan, deleteTerm, putCourses, deleteCourses, putAppt. */
export function diffOps(acked: Acked, desired: Desired): SyncOp[] {
  const ops: SyncOp[] = [];
  if (desired.terms) {
    const { terms, plans } = splitTerms(desired.terms);
    for (const [termKey, meta] of Object.entries(terms)) {
      const prev = acked.terms.get(termKey);
      if (!prev || prev.json !== JSON.stringify(meta)) {
        ops.push({ op: 'putTerm', termKey, baseVersion: prev?.version ?? 0, data: meta });
      }
    }
    for (const [planId, { termKey, plan }] of Object.entries(plans)) {
      const prev = acked.plans.get(planId);
      if (!prev || prev.termKey !== termKey || prev.json !== JSON.stringify(plan)) {
        ops.push({ op: 'putPlan', planId, termKey, baseVersion: prev?.version ?? 0, data: plan });
      }
    }
    for (const [planId, prev] of acked.plans) {
      if (!plans[planId]) ops.push({ op: 'deletePlan', planId, baseVersion: prev.version });
    }
    for (const [termKey, prev] of acked.terms) {
      if (!terms[termKey]) ops.push({ op: 'deleteTerm', termKey, baseVersion: prev.version });
    }
  }

  const changed = desired.pool.filter((c) => acked.pool.get(c.id) !== JSON.stringify(c));
  if (changed.length > 0) ops.push({ op: 'putCourses', courses: changed });
  const keep = new Set(desired.pool.map((c) => c.id));
  const dropped = [...acked.pool.keys()].filter((id) => !keep.has(id));
  if (dropped.length > 0) ops.push({ op: 'deleteCourses', ids: dropped });

  if (desired.appt !== null && JSON.stringify(desired.appt) !== acked.appt) {
    ops.push({ op: 'putAppt', data: desired.appt });
  }
  return ops;
}

/** The acked state after `sent` succeeded. Versions come from the response; never mutates its inputs. */
export function applyAck(acked: Acked, sent: SyncOp[], versions: SyncVersions): Acked {
  const out: Acked = {
    terms: new Map(acked.terms), plans: new Map(acked.plans), pool: new Map(acked.pool), appt: acked.appt,
  };
  for (const op of sent) {
    switch (op.op) {
      case 'putTerm': {
        const version = versions.terms[op.termKey];
        if (version === undefined) throw new Error(`sync ack missing version for term ${op.termKey}`);
        out.terms.set(op.termKey, { version, json: JSON.stringify(op.data) });
        break;
      }
      case 'putPlan': {
        const version = versions.plans[op.planId];
        if (version === undefined) throw new Error(`sync ack missing version for plan ${op.planId}`);
        out.plans.set(op.planId, { version, termKey: op.termKey, json: JSON.stringify(op.data) });
        break;
      }
      case 'deleteTerm': out.terms.delete(op.termKey); break;
      case 'deletePlan': out.plans.delete(op.planId); break;
      case 'putCourses': for (const c of op.courses) out.pool.set(c.id, JSON.stringify(c)); break;
      case 'deleteCourses': for (const id of op.ids) out.pool.delete(id); break;
      case 'putAppt': out.appt = JSON.stringify(op.data); break;
    }
  }
  return out;
}

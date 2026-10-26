/**
 * A CloudBoot for tests: the real boot assembly and sync engine, talking to an
 * in-memory server that acks every put with a fresh version and records each
 * request in `sent`. Nothing reaches fetch.
 */
import type { CourseOffering, SyncOp, SyncVersions } from '@triton/shared';
import type { Me } from '../lib/cloud/api';
import { makeBoot, type CloudBoot } from '../lib/cloud/boot';
import type { SendResult } from '../lib/cloud/engine';
import { splitTerms, type WebSnapshot } from '../lib/cloud/records';
import type { TermsState } from '../lib/terms-state';

export const TEST_ME: Me = { email: 'student@ucsd.edu', hasPassword: true, hasGoogle: false };

/** The snapshot GET /api/state would return for this state (distinct positive versions, like the server's counter). */
export function snapshotOf(terms?: TermsState, pool: CourseOffering[] = []): WebSnapshot {
  if (!terms) return { terms: {}, plans: {}, pool, appt: null };
  const split = splitTerms(terms);
  let v = 0;
  return {
    terms: Object.fromEntries(Object.entries(split.terms).map(([k, data]) => [k, { version: ++v, data }])),
    plans: Object.fromEntries(
      Object.entries(split.plans).map(([id, p]) => [id, { version: ++v, termKey: p.termKey, data: p.plan }]),
    ),
    pool,
    appt: null,
  };
}

export function makeTestBoot(
  o: { terms?: TermsState; pool?: CourseOffering[] } = {},
): CloudBoot & { sent: SyncOp[][] } {
  const sent: SyncOp[][] = [];
  let counter = 1000;
  const send = async (ops: SyncOp[]): Promise<SendResult> => {
    sent.push(ops);
    const versions: SyncVersions = { terms: {}, plans: {} };
    for (const op of ops) {
      if (op.op === 'putTerm') versions.terms[op.termKey] = ++counter;
      if (op.op === 'putPlan') versions.plans[op.planId] = ++counter;
    }
    return { ok: true, versions };
  };
  return { ...makeBoot(TEST_ME, snapshotOf(o.terms, o.pool), send), sent };
}

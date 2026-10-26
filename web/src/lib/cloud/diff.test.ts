import { describe, it, expect } from 'vitest';
import type { ApptTimes, CourseOffering, PlanState, Term } from '@triton/shared';
import type { NamedPlan } from '../plans';
import type { TermsState } from '../terms-state';
import { applyAck, ackedFromSnapshot, diffOps, type Desired } from './diff';
import { splitTerms, type WebSnapshot } from './records';

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WI: Term = { year: '2027', period: '3', label: 'Winter 2027' };
const ps = (term: Term): PlanState => ({ version: 1, term, entries: [] });
const np = (id: string, term: Term): NamedPlan =>
  ({ id, name: id, plan: ps(term), createdAt: 'c', updatedAt: 'u', browsed: [] });
const course = (id: string, n = 0) => ({ id, title: `t${n}` }) as unknown as CourseOffering;

function state(): TermsState {
  return {
    version: 1,
    activeTermKey: '2026|2',
    terms: {
      '2026|2': { term: FA, plans: { activeId: 'a', plans: [np('a', FA), np('b', FA)] } },
      '2027|3': { term: WI, plans: { activeId: 'c', plans: [np('c', WI)] } },
    },
  };
}
const appt: ApptTimes[] = [{ slot: 1 }] as unknown as ApptTimes[];

function snapshot(s: TermsState, pool: CourseOffering[], a: ApptTimes[] | null): WebSnapshot {
  const { terms, plans } = splitTerms(s);
  return {
    terms: Object.fromEntries(Object.entries(terms).map(([k, data], i) => [k, { version: 10 + i, data }])),
    plans: Object.fromEntries(Object.entries(plans).map(([id, p], i) => [id, { version: 20 + i, termKey: p.termKey, data: p.plan }])),
    pool, appt: a,
  };
}
const want = (terms: TermsState | null, pool: CourseOffering[] = [], a: ApptTimes[] | null = null): Desired =>
  ({ terms, pool, appt: a });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('diffOps', () => {
  it('no change → no ops', () => {
    const s = state();
    const acked = ackedFromSnapshot(snapshot(s, [course('x')], appt));
    expect(diffOps(acked, want(clone(s), [course('x')], clone(appt)))).toEqual([]);
  });

  it('renaming a plan sends one putPlan with the acked version as base', () => {
    const s = state();
    const snap = snapshot(s, [], null);
    const next = clone(s);
    next.terms['2026|2']!.plans.plans[1]!.name = 'renamed';
    const ops = diffOps(ackedFromSnapshot(snap), want(next));
    expect(ops).toEqual([{ op: 'putPlan', planId: 'b', termKey: '2026|2', baseVersion: snap.plans.b!.version, data: next.terms['2026|2']!.plans.plans[1] }]);
  });

  it('a new plan sends putPlan base 0 plus putTerm for the new planOrder', () => {
    const s = state();
    const snap = snapshot(s, [], null);
    const next = clone(s);
    next.terms['2027|3']!.plans.plans.push(np('d', WI));
    const ops = diffOps(ackedFromSnapshot(snap), want(next));
    expect(ops.map((o) => o.op)).toEqual(['putTerm', 'putPlan']);
    expect(ops[0]).toMatchObject({ termKey: '2027|3', baseVersion: snap.terms['2027|3']!.version });
    expect(ops[0]).toMatchObject({ data: { planOrder: ['c', 'd'] } });
    expect(ops[1]).toMatchObject({ planId: 'd', termKey: '2027|3', baseVersion: 0 });
  });

  it('a deleted plan sends deletePlan and putTerm', () => {
    const s = state();
    const snap = snapshot(s, [], null);
    const next = clone(s);
    next.terms['2026|2']!.plans.plans.pop();
    const ops = diffOps(ackedFromSnapshot(snap), want(next));
    expect(ops.map((o) => o.op)).toEqual(['putTerm', 'deletePlan']);
    expect(ops[1]).toEqual({ op: 'deletePlan', planId: 'b', baseVersion: snap.plans.b!.version });
  });

  it('a deleted term sends deletePlan for each of its plans plus deleteTerm', () => {
    const s = state();
    const snap = snapshot(s, [], null);
    const next = clone(s);
    delete next.terms['2026|2'];
    next.activeTermKey = '2027|3';
    const ops = diffOps(ackedFromSnapshot(snap), want(next));
    expect(ops.map((o) => o.op)).toEqual(['deletePlan', 'deletePlan', 'deleteTerm']);
    expect(ops[2]).toEqual({ op: 'deleteTerm', termKey: '2026|2', baseVersion: snap.terms['2026|2']!.version });
  });

  it('moving a plan between terms sends putPlan with the new termKey plus putTerm for both', () => {
    const s = state();
    const snap = snapshot(s, [], null);
    const next = clone(s);
    const [moved] = next.terms['2026|2']!.plans.plans.splice(1, 1);
    next.terms['2027|3']!.plans.plans.push(moved!);
    const ops = diffOps(ackedFromSnapshot(snap), want(next));
    expect(ops.map((o) => o.op)).toEqual(['putTerm', 'putTerm', 'putPlan']);
    expect(ops[2]).toMatchObject({ planId: 'b', termKey: '2027|3', baseVersion: snap.plans.b!.version });
  });

  it('null desired terms emits no term or plan ops', () => {
    const acked = ackedFromSnapshot(snapshot(state(), [], null));
    expect(diffOps(acked, want(null))).toEqual([]);
  });

  it('only changed or new courses are uploaded; dropped ones are deleted', () => {
    const acked = ackedFromSnapshot(snapshot(state(), [course('keep'), course('chg'), course('drop')], null));
    const ops = diffOps(acked, want(state(), [course('keep'), course('chg', 1), course('new')]));
    expect(ops).toEqual([
      { op: 'putCourses', courses: [course('chg', 1), course('new')] },
      { op: 'deleteCourses', ids: ['drop'] },
    ]);
  });

  it('putAppt is sent when appt changed; null desired appt sends nothing', () => {
    const acked = ackedFromSnapshot(snapshot(state(), [], null));
    expect(diffOps(acked, want(state(), [], appt))).toEqual([{ op: 'putAppt', data: appt }]);
    expect(diffOps(ackedFromSnapshot(snapshot(state(), [], appt)), want(state(), [], null))).toEqual([]);
  });
});

describe('applyAck', () => {
  it('makes the same desired state diff to nothing, taking versions from the response', () => {
    const acked = ackedFromSnapshot(snapshot(state(), [course('drop')], null));
    const next = clone(state());
    next.terms['2026|2']!.plans.plans.push(np('n', FA));
    delete next.terms['2027|3'];
    next.activeTermKey = '2026|2';
    const desired = want(next, [course('new')], appt);
    const ops = diffOps(acked, desired);
    const out = applyAck(acked, ops, { terms: { '2026|2': 99 }, plans: { n: 77 } });
    expect(out.terms.get('2026|2')!.version).toBe(99);
    expect(out.plans.get('n')!.version).toBe(77);
    expect(out.terms.has('2027|3')).toBe(false);
    expect(out.plans.has('c')).toBe(false);
    expect(diffOps(out, desired)).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const acked = ackedFromSnapshot(snapshot(state(), [course('drop')], null));
    const next = clone(state());
    next.terms['2026|2']!.plans.plans.pop();
    const ops = diffOps(acked, want(next, [course('new')], appt));
    const before = JSON.stringify([[...acked.terms], [...acked.plans], [...acked.pool], acked.appt, ops]);
    applyAck(acked, ops, { terms: { '2026|2': 5 }, plans: {} });
    expect(JSON.stringify([[...acked.terms], [...acked.plans], [...acked.pool], acked.appt, ops])).toBe(before);
  });

  it('throws when a put has no version in the response', () => {
    const acked = ackedFromSnapshot(snapshot(state(), [], null));
    const next = clone(state());
    next.terms['2026|2']!.plans.plans[0]!.name = 'x';
    const ops = diffOps(acked, want(next));
    expect(() => applyAck(acked, ops, { terms: {}, plans: {} })).toThrow();
  });
});

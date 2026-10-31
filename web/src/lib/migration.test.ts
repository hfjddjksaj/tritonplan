import { describe, it, expect, beforeEach } from 'vitest';
import type { PlanState, Term } from '@triton/shared';
import {
  collectLegacyPayload, isMigrationPayload, mergeMigration, fnv1a,
  savePendingMigration, loadPendingMigration, clearPendingMigration,
  MIGRATION_PENDING_KEY, MIGRATE_MSG, type MigrationPayload,
} from './migration';
import { isTermShape, saveTerms, savePlans, savePlan, savePool, saveApptTimes, saveReceived } from './storage';
import type { TermsState, TermWorkspace } from './terms-state';
import { planToMirrorHash, mirrorTokenFromHash, decodePlan } from './share';
import { emptyPlan } from './plan';
import { makeCourse } from './fixtures';
import type { NamedPlan } from './plans';

const NOW = '2026-10-26T10:00:00.000Z';
const FALL: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER: Term = { year: '2027', period: '3', label: 'Winter 2027' };

function courseIn(term: Term, n: string, units = 4) {
  const c = makeCourse(`${n}|${term.year}|${term.period}`, n, units);
  return { ...c, term };
}
function planWith(term: Term, ...names: string[]): PlanState {
  return {
    ...emptyPlan(term),
    entries: names.map((n) => {
      const c = courseIn(term, n);
      return { course: c, selectedOptionId: c.options[0]!.id, color: '231' };
    }),
  };
}
function named(id: string, term: Term, names: string[], display = id): NamedPlan {
  const plan = planWith(term, ...names);
  return { id, name: display, plan, createdAt: NOW, updatedAt: NOW, browsed: plan.entries.map((e) => e.course.id) };
}
function ws(term: Term, plans: NamedPlan[], extra: Partial<TermWorkspace> = {}): TermWorkspace {
  return { term, plans: { activeId: plans[0]!.id, plans }, ...extra };
}
function terms(...pairs: [string, TermWorkspace][]): TermsState {
  return { version: 1, activeTermKey: pairs[0]![0], terms: Object.fromEntries(pairs) };
}
function payload(over: Partial<MigrationPayload> = {}): MigrationPayload {
  return {
    kind: 'tritonplan-migration', version: 1, exportedAt: NOW,
    terms: null, plans: null, plan: null, pool: [], appt: null, received: null, hashPlan: null,
    ...over,
  };
}
const EMPTY_ACCOUNT = { terms: null, pool: [], appt: null };
const allIds = (t: TermsState) => Object.values(t.terms).flatMap((w) => w.plans.plans.map((p) => p.id));

const legacy = () => terms(
  ['2026|2', ws(FALL, [named('a1', FALL, ['CSE-8A']), named('a2', FALL, ['CSE-11'])], { bookedOn: ['x'] })],
  ['2027|3', ws(WINTER, [named('w1', WINTER, ['CSE-12'])])],
);

beforeEach(() => localStorage.clear());

describe('fnv1a', () => {
  it('matches known 32-bit FNV-1a vectors as 8 lowercase hex chars', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});

describe('mergeMigration', () => {
  it('an empty account receives every term and every plan', () => {
    const p = payload({ terms: legacy() });
    const r = mergeMigration(EMPTY_ACCOUNT, p, NOW);
    expect(allIds(r.terms).sort()).toEqual(['a1', 'a2', 'w1']);
    expect(r.added).toEqual({ terms: 2, plans: 3 });
    expect(r.skipped).toBe(0);
    expect(r.terms.activeTermKey).toBe('2027|3'); // newest
    expect(r.terms.terms['2026|2']!.bookedOn).toEqual(['x']);
  });

  it('importing the same payload twice adds nothing the second time', () => {
    const p = payload({
      terms: legacy(),
      received: { plan: planWith(FALL, 'MATH-20A'), source: 'link', receivedAt: NOW },
      hashPlan: planWith(WINTER, 'PHYS-2A'),
    });
    const first = mergeMigration(EMPTY_ACCOUNT, p, NOW);
    expect(first.added.plans).toBe(5);
    const second = mergeMigration({ terms: first.terms, pool: first.pool, appt: first.appt }, p, '2026-10-27T00:00:00.000Z');
    expect(second.added).toEqual({ terms: 0, plans: 0 });
    expect(second.skipped).toBe(5);
    expect(allIds(second.terms).sort()).toEqual(allIds(first.terms).sort());
  });

  it('existing account plans are untouched and booked marks are unioned', () => {
    const acct = terms(['2026|2', ws(FALL, [named('mine', FALL, ['BILD-1'])], { bookedOn: ['b'], bookedAuto: ['z'] })]);
    const before = JSON.parse(JSON.stringify(acct));
    const p = payload({ terms: legacy() });
    const pBefore = JSON.parse(JSON.stringify(p));
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, p, NOW);
    const fall = r.terms.terms['2026|2']!;
    expect(fall.plans.activeId).toBe('mine');
    expect(fall.plans.plans.map((x) => x.id)).toEqual(['mine', 'a1', 'a2']);
    expect(fall.plans.plans[0]).toEqual(acct.terms['2026|2']!.plans.plans[0]);
    expect(fall.bookedOn).toEqual(['b', 'x']);
    expect(fall.bookedAuto).toEqual(['z']);
    expect(r.terms.activeTermKey).toBe('2026|2');
    expect(r.added).toEqual({ terms: 1, plans: 3 });
    // inputs never mutated
    expect(JSON.parse(JSON.stringify(acct))).toEqual(before);
    expect(JSON.parse(JSON.stringify(p))).toEqual(pBefore);
  });

  it('a plan id already in the account under another term is skipped and counted', () => {
    const acct = terms(['2027|3', ws(WINTER, [named('a1', WINTER, ['OTHER'])])]);
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: legacy() }), NOW);
    expect(r.skipped).toBe(1);
    expect(r.added.plans).toBe(2);
    expect(r.terms.terms['2026|2']!.plans.plans.map((x) => x.id)).toEqual(['a2']);
  });

  it('the received plan becomes "Shared plan (old site)" in its own term', () => {
    const rp = planWith(WINTER, 'CSE-100');
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ received: { plan: rp, source: 'link', receivedAt: NOW } }), NOW);
    const w = r.terms.terms['2027|3']!;
    expect(w.plans.plans).toHaveLength(1);
    expect(w.plans.plans[0]!.name).toBe('Shared plan (old site)');
    expect(w.plans.plans[0]!.id).toMatch(/^m-[0-9a-f]{8}$/);
    expect(w.plans.plans[0]!.plan).toEqual(rp);
    expect(r.added).toEqual({ terms: 1, plans: 1 });
  });

  it('a #m= bookmark plan identical to a saved plan is not duplicated', () => {
    const t = legacy();
    const same = t.terms['2026|2']!.plans.plans[0]!.plan;
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t, hashPlan: same }), NOW);
    expect(r.added.plans).toBe(3);
    expect(allIds(r.terms).filter((i) => i.startsWith('m-'))).toEqual([]);
    const r2 = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t, hashPlan: planWith(FALL, 'NEW-1') }), NOW);
    const names = r2.terms.terms['2026|2']!.plans.plans.map((x) => x.name);
    expect(names).toContain('Plan from bookmark');
    expect(r2.added.plans).toBe(4);
  });

  it('the pristine empty "My plan" is not imported', () => {
    const r = mergeMigration(EMPTY_ACCOUNT, payload(), NOW);
    expect(r.added).toEqual({ terms: 0, plans: 0 });
    expect(r.skipped).toBe(0);
    const acct = terms(['2026|2', ws(FALL, [named('mine', FALL, ['A'])])]);
    const r2 = mergeMigration({ terms: acct, pool: [], appt: null }, payload(), NOW);
    expect(allIds(r2.terms)).toEqual(['mine']);
  });

  it('a plan with no courses but browsed history is kept', () => {
    const p = named('b1', FALL, []);
    p.browsed = ['CSE-8A|2026|2'];
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: terms(['2026|2', ws(FALL, [p])]) }), NOW);
    expect(allIds(r.terms)).toEqual(['b1']);
  });

  it('a pre-terms payload (plans:v1 only) still imports', () => {
    const plans = { activeId: 'p-1', plans: [named('p-1', FALL, ['CSE-8A']), named('p-2', WINTER, ['CSE-12'])] };
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ plans }), NOW);
    expect(allIds(r.terms).sort()).toEqual(['p-1', 'p-2']);
    expect(r.added).toEqual({ terms: 2, plans: 2 });
  });

  it('a pre-terms single plan (plan:v1) plus pool still imports', () => {
    const course = courseIn(FALL, 'PHYS-2A');
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ plan: planWith(FALL, 'CSE-8A'), pool: [course] }), NOW);
    expect(r.added).toEqual({ terms: 1, plans: 1 });
    expect(r.pool).toEqual([course]);
    const imported = Object.values(r.terms.terms)[0]!.plans.plans[0]!;
    expect(imported.browsed).toContain(course.id);
  });

  it('the account keeps its newer copy of a course', () => {
    const old = courseIn(FALL, 'CSE-8A', 3);
    const fresh = courseIn(FALL, 'CSE-8A', 5);
    const extra = courseIn(FALL, 'ONLY-OLD');
    const r = mergeMigration({ terms: null, pool: [fresh], appt: null }, payload({ pool: [old, extra] }), NOW);
    expect(r.pool.find((c) => c.id === old.id)!.units).toBe(5);
    expect(r.pool.map((c) => c.id).sort()).toEqual([old.id, extra.id].sort());
  });

  it('appointment times: the account wins when it has any, else the old site fills in', () => {
    const a = [{ academicYear: '1' }] as never;
    const b = [{ academicYear: '2' }] as never;
    expect(mergeMigration({ ...EMPTY_ACCOUNT, appt: a }, payload({ appt: b }), NOW).appt).toBe(a);
    expect(mergeMigration({ ...EMPTY_ACCOUNT, appt: [] }, payload({ appt: b }), NOW).appt).toBe(b);
    expect(mergeMigration(EMPTY_ACCOUNT, payload({ appt: null }), NOW).appt).toBeNull();
  });

  it('skips and counts plan ids the server would reject, without throwing', () => {
    const bad = ['__proto__', 'constructor', 'prototype', '', 'x'.repeat(101)];
    const plans = [...bad.map((id) => named(id, FALL, ['C'])), named('ok', FALL, ['D'])];
    const t = terms(['2026|2', ws(FALL, plans)]);
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t }), NOW);
    expect(allIds(r.terms)).toEqual(['ok']);
    expect(r.skipped).toBe(5);
    expect(r.added.plans).toBe(1);
  });

  it('skips a term whose key the server would reject', () => {
    const weird: Term = { year: '__proto__', period: '', label: '' };
    const t: TermsState = { version: 1, activeTermKey: '2026|2', terms: { '2026|2': ws(FALL, [named('a', FALL, ['C'])]) } };
    Object.defineProperty(t.terms, 'constructor', { value: ws(weird, [named('c', weird, ['C'])]), enumerable: true });
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t }), NOW);
    expect(Object.keys(r.terms.terms)).toEqual(['2026|2']);
    expect(r.skipped).toBe(1);
  });

  it('received / hashPlan with a garbage term are skipped and counted, never imported', () => {
    const junk = { ...planWith(FALL, 'A'), term: { year: 5, period: null, label: {} } } as unknown as PlanState;
    const junk2 = { ...planWith(FALL, 'B'), term: { year: 5, period: null, label: {} } } as unknown as PlanState;
    const r = mergeMigration(EMPTY_ACCOUNT, payload({
      received: { plan: junk, source: 'link', receivedAt: NOW }, hashPlan: junk2,
    }), NOW);
    expect(r.added).toEqual({ terms: 0, plans: 0 });
    expect(r.skipped).toBe(2);
    for (const w of Object.values(r.terms.terms)) expect(isTermShape(w.term)).toBe(true);
    expect(allIds(r.terms).some((i) => i.startsWith('m-'))).toBe(false);
  });

  // ---- R29 fix round 1 ----

  it('C1: a plan:v1-only payload does not duplicate on re-import', () => {
    const p = payload({ plan: planWith(FALL, 'CSE-8A') });
    const first = mergeMigration(EMPTY_ACCOUNT, p, NOW);
    expect(first.added).toEqual({ terms: 1, plans: 1 });
    expect(allIds(first.terms)[0]).toMatch(/^m-[0-9a-f]{8}$/);
    const second = mergeMigration({ terms: first.terms, pool: first.pool, appt: first.appt }, p, '2026-11-01T00:00:00.000Z');
    expect(second.added).toEqual({ terms: 0, plans: 0 });
    expect(second.skipped).toBe(1);
    expect(allIds(second.terms)).toEqual(allIds(first.terms));
  });

  it('C1: a pool-only payload (bootstrap plan with browsed history) does not duplicate on re-import', () => {
    const p = payload({ pool: [courseIn(FALL, 'PHYS-2A')] });
    const first = mergeMigration(EMPTY_ACCOUNT, p, NOW);
    expect(first.added.plans).toBe(1);
    const second = mergeMigration({ terms: first.terms, pool: first.pool, appt: first.appt }, p, '2026-11-01T00:00:00.000Z');
    expect(second.added).toEqual({ terms: 0, plans: 0 });
    expect(second.skipped).toBe(1);
  });

  it('I1: with an account feed the account keeps auto/waitlisted/off and only bookedOn is unioned', () => {
    const acct = terms(['2026|2', ws(FALL, [named('mine', FALL, ['A'])], {
      bookedAuto: ['CSE-8A|2026|2'], bookedOn: ['b'], bookedOff: [], waitlistedAuto: ['wl'],
    })]);
    const old = terms(['2026|2', ws(FALL, [named('a1', FALL, ['C'])], {
      bookedAuto: ['stale'], bookedOn: ['x'], bookedOff: ['CSE-8A|2026|2'], waitlistedAuto: ['old-wl'],
    })]);
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: old }), NOW);
    const w = r.terms.terms['2026|2']!;
    expect(w.bookedAuto).toEqual(['CSE-8A|2026|2']);
    expect(w.bookedOff).toEqual([]);
    expect(w.waitlistedAuto).toEqual(['wl']);
    expect(w.bookedOn).toEqual(['b', 'x']);
  });

  it('I1: without an account feed for the term, all four lists are taken and unioned', () => {
    const acct = terms(['2026|2', ws(FALL, [named('mine', FALL, ['A'])], { bookedOn: ['b'] })]);
    const old = terms(['2026|2', ws(FALL, [named('a1', FALL, ['C'])], {
      bookedAuto: ['y'], bookedOn: ['x'], bookedOff: ['o'], waitlistedAuto: ['w'],
    })]);
    const w = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: old }), NOW).terms.terms['2026|2']!;
    expect(w.bookedAuto).toEqual(['y']);
    expect(w.bookedOn).toEqual(['b', 'x']);
    expect(w.bookedOff).toEqual(['o']);
    expect(w.waitlistedAuto).toEqual(['w']);
  });

  it('I3: a hashPlan equal to a plan already in the account is not added', () => {
    const shared = planWith(FALL, 'CSE-100');
    const acct = terms(['2026|2', ws(FALL, [{ ...named('other-device', FALL, []), plan: shared }])]);
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ hashPlan: shared }), NOW);
    expect(r.added).toEqual({ terms: 0, plans: 0 });
    expect(r.skipped).toBe(1);
    expect(allIds(r.terms)).toEqual(['other-device']);
  });

  it('I3: a received plan equal to one of the student\'s own plans is not added', () => {
    const t = legacy();
    const own = t.terms['2026|2']!.plans.plans[0]!.plan;
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t, received: { plan: own, source: 'link', receivedAt: NOW } }), NOW);
    expect(r.added.plans).toBe(3);
    expect(r.skipped).toBe(1);
    expect(allIds(r.terms).some((i) => i.startsWith('m-'))).toBe(false);
  });

  it('I3: received and hashPlan identical to each other add only one', () => {
    const same = planWith(FALL, 'CSE-100');
    const r = mergeMigration(EMPTY_ACCOUNT, payload({
      received: { plan: same, source: 'link', receivedAt: NOW }, hashPlan: same,
    }), NOW);
    expect(r.added.plans).toBe(1);
    expect(r.skipped).toBe(1);
    expect(allIds(r.terms)).toHaveLength(1);
  });

  it('M2: an empty plan is skipped only in a pristine workspace; a renamed empty "Plan B" is imported', () => {
    const t = terms(['2026|2', ws(FALL, [named('my', FALL, [], 'My plan'), named('planb', FALL, [], 'Plan B')])]);
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t }), NOW);
    expect(allIds(r.terms).sort()).toEqual(['my', 'planb']);
    const pristineOnly = terms(['2026|2', ws(FALL, [named('my', FALL, [], 'My plan')])]);
    const r2 = mergeMigration(EMPTY_ACCOUNT, payload({ terms: pristineOnly }), NOW);
    expect(r2.added.plans).toBe(0);
    expect(r2.skipped).toBe(0);
  });

  it('M4: a pristine account workspace is replaced by the legacy workspace for that term', () => {
    const acct = terms(['2026|2', ws(FALL, [named('boot', FALL, [])])]);
    const t = legacy();
    t.terms['2026|2']!.plans.activeId = 'a2';
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: t }), NOW);
    const fall = r.terms.terms['2026|2']!;
    expect(fall.plans.plans.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(fall.plans.activeId).toBe('a2');
    expect(r.added).toEqual({ terms: 2, plans: 3 }); // the replaced Fall term and the new Winter term
    // nothing importable for that term: the account's pristine workspace stays
    const r2 = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: terms(['2027|3', t.terms['2027|3']!]) }), NOW);
    expect(r2.terms.terms['2026|2']!.plans.plans.map((x) => x.id)).toEqual(['boot']);
  });

  it('N1: a replaced pristine account workspace keeps the account feed and unions only bookedOn', () => {
    const acct = terms(['2026|2', ws(FALL, [named('boot', FALL, [])], {
      bookedAuto: ['CSE-8A|2026|2'], bookedOn: ['b'], bookedOff: [], waitlistedAuto: ['wl'],
    })]);
    const old = terms(['2026|2', ws(FALL, [named('a1', FALL, ['C'])], {
      bookedAuto: ['stale'], bookedOn: ['x'], bookedOff: ['CSE-8A|2026|2'], waitlistedAuto: ['old-wl'],
    })]);
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: old }), NOW);
    const w = r.terms.terms['2026|2']!;
    expect(w.plans.plans.map((x) => x.id)).toEqual(['a1']);
    expect(w.bookedAuto).toEqual(['CSE-8A|2026|2']);
    expect(w.bookedOff).toEqual([]);
    expect(w.waitlistedAuto).toEqual(['wl']);
    expect(w.bookedOn).toEqual(['b', 'x']);
  });

  it('N1: an extra replacing a pristine account workspace keeps that workspace\'s booked lists', () => {
    const acct = terms(['2026|2', ws(FALL, [named('boot', FALL, [])], { bookedAuto: ['k'], bookedOn: ['b'] })]);
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ hashPlan: planWith(FALL, 'NEW') }), NOW);
    const w = r.terms.terms['2026|2']!;
    expect(w.plans.plans.map((x) => x.name)).toEqual(['Plan from bookmark']);
    expect(w.bookedAuto).toEqual(['k']);
    expect(w.bookedOn).toEqual(['b']);
  });

  it('N4: an imported empty renamed plan is not dropped by an extra landing in the same term', () => {
    const acct = terms(['2026|2', ws(FALL, [named('boot', FALL, [])])]);
    const old = terms(['2026|2', ws(FALL, [named('planb', FALL, [], 'Plan B'), named('planc', FALL, [], 'Plan C')])]);
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({
      terms: old, hashPlan: planWith(FALL, 'NEW'),
    }), NOW);
    expect(r.terms.terms['2026|2']!.plans.plans.map((x) => x.id).sort()).toEqual(
      ['planb', 'planc', allIds(r.terms).find((i) => i.startsWith('m-'))!].sort(),
    );
    expect(r.added.plans).toBe(3);
  });

  it('M1: isMigrationPayload rejects a bad appt list, a malformed received and a bad waitlistedAuto', () => {
    expect(isMigrationPayload({ ...payload(), appt: [{ academicYear: 1 }] })).toBe(false);
    expect(isMigrationPayload({ ...payload(), appt: 'x' })).toBe(false);
    expect(isMigrationPayload({ ...payload(), received: { plan: planWith(FALL, 'A'), source: 'nope', receivedAt: NOW } })).toBe(false);
    expect(isMigrationPayload({ ...payload(), received: { plan: planWith(FALL, 'A'), source: 'link' } })).toBe(false);
    const bad = legacy();
    (bad.terms['2026|2'] as unknown as Record<string, unknown>).waitlistedAuto = [1, 2];
    expect(isMigrationPayload({ ...payload(), terms: bad })).toBe(false);
  });

  it('M5: a real #m= token decoded via mirrorTokenFromHash/decodePlan is deduped against a saved plan', () => {
    const saved = planWith(FALL, 'CSE-8A');
    const t = terms(['2026|2', ws(FALL, [{ ...named('s1', FALL, []), plan: saved }])]);
    const hash = '#' + planToMirrorHash(saved);
    const decoded = decodePlan(mirrorTokenFromHash(hash)!)!;
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ terms: t, hashPlan: decoded }), NOW);
    expect(r.added.plans).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('M5: plans:v1 with a hidden list and a pool seeds browsed from pool minus hidden', () => {
    const p1 = courseIn(FALL, 'P1');
    const p2 = courseIn(FALL, 'P2');
    const np: NamedPlan = { ...named('p-1', FALL, ['CSE-8A']), hidden: [p2.id], browsed: undefined };
    const r = mergeMigration(EMPTY_ACCOUNT, payload({ plans: { activeId: 'p-1', plans: [np] }, pool: [p1, p2] }), NOW);
    const imported = r.terms.terms['2026|2']!.plans.plans[0]!;
    expect(imported.id).toBe('p-1');
    expect(imported.browsed).toContain(p1.id);
    expect(imported.browsed).not.toContain(p2.id);
    expect('hidden' in imported).toBe(false);
  });

  it('M6: skipped counts duplicates and invalid ids exactly, not pristine drops', () => {
    const acct = terms(['2026|2', ws(FALL, [named('a1', FALL, ['CSE-8A'])])]);
    const t = terms(
      ['2026|2', ws(FALL, [named('a1', FALL, ['CSE-8A']), named('__proto__', FALL, ['X']), named('n1', FALL, ['Y'])])],
      ['2027|3', ws(WINTER, [named('w', WINTER, [], 'My plan')])],
    );
    const r = mergeMigration({ terms: acct, pool: [], appt: null }, payload({ terms: t }), NOW);
    expect(r.added).toEqual({ terms: 0, plans: 1 });
    expect(r.skipped).toBe(2);
  });
});

describe('isMigrationPayload', () => {
  it('rejects junk, other kinds and wrong versions', () => {
    for (const v of [null, undefined, 3, 'x', [], {}, { ...payload(), kind: 'other' }, { ...payload(), version: 2 },
      { ...payload(), pool: 'no' }, { ...payload(), terms: { version: 1 } }, { ...payload(), exportedAt: 5 },
      { ...payload(), received: { plan: 1 } }]) {
      expect(isMigrationPayload(v)).toBe(false);
    }
  });
  it('accepts a valid payload and tolerates extra fields', () => {
    expect(isMigrationPayload(payload())).toBe(true);
    expect(isMigrationPayload({ ...payload({ terms: legacy() }), future: 1 })).toBe(true);
  });
});

describe('collectLegacyPayload', () => {
  it('reads every legacy key through the loaders', () => {
    const t = legacy();
    saveTerms(t);
    savePool([courseIn(FALL, 'POOL')]);
    saveReceived({ plan: planWith(FALL, 'R'), source: 'link', receivedAt: NOW });
    saveApptTimes([{ academicYear: '2026', academicSession: '2', yearText: '', sessionText: '', windows: [], capturedAt: NOW }]);
    const mine = planWith(FALL, 'HASH');
    const p = collectLegacyPayload('#' + planToMirrorHash(mine), NOW);
    expect(isMigrationPayload(p)).toBe(true);
    expect(p.exportedAt).toBe(NOW);
    expect(p.terms).toEqual(t);
    expect(p.pool).toHaveLength(1);
    expect(p.received!.source).toBe('link');
    expect(p.appt).toHaveLength(1);
    expect(p.hashPlan!.entries[0]!.course.courseCode).toBe('HASH');
  });
  it('an old pre-terms browser yields plans/plan and nulls elsewhere', () => {
    savePlans({ activeId: 'p-1', plans: [named('p-1', FALL, ['A'])] });
    savePlan(planWith(FALL, 'B'));
    const p = collectLegacyPayload('', NOW);
    expect(p.terms).toBeNull();
    expect(p.plans!.plans).toHaveLength(1);
    expect(p.plan).not.toBeNull();
    expect(p.hashPlan).toBeNull();
    expect(p.received).toBeNull();
    expect(p.pool).toEqual([]);
  });
  it('an undecodable #m= token yields no hashPlan', () => {
    expect(collectLegacyPayload('#m=garbage', NOW).hashPlan).toBeNull();
  });
});

describe('pending migration storage', () => {
  it('round-trips and clears', () => {
    const p = payload({ terms: legacy() });
    expect(savePendingMigration(p)).toBe(true);
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).not.toBeNull();
    expect(loadPendingMigration()).toEqual(p);
    clearPendingMigration();
    expect(loadPendingMigration()).toBeNull();
  });
  it('returns null for invalid or corrupt stored values', () => {
    localStorage.setItem(MIGRATION_PENDING_KEY, '{"kind":"nope"}');
    expect(loadPendingMigration()).toBeNull();
    localStorage.setItem(MIGRATION_PENDING_KEY, '{not json');
    expect(loadPendingMigration()).toBeNull();
  });
  it('never throws when storage is unavailable', () => {
    const orig = Storage.prototype.getItem;
    const origSet = Storage.prototype.setItem;
    const origRm = Storage.prototype.removeItem;
    const boom = () => { throw new Error('denied'); };
    Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom;
    try {
      expect(savePendingMigration(payload())).toBe(false);
      expect(loadPendingMigration()).toBeNull();
      expect(() => clearPendingMigration()).not.toThrow();
    } finally {
      Storage.prototype.getItem = orig; Storage.prototype.setItem = origSet; Storage.prototype.removeItem = origRm;
    }
  });
});

describe('MIGRATE_MSG', () => {
  it('has the agreed names', () => {
    expect(MIGRATE_MSG).toEqual({ ready: 'tp-migrate-ready', payload: 'tp-migrate-payload', ack: 'tp-migrate-ack' });
  });
});

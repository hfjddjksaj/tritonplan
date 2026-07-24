import { describe, it, expect } from 'vitest';
import type { PlanState } from '@triton/shared';
import {
  migratePlans,
  activePlan,
  updateActivePlan,
  createPlan,
  addPlan,
  renamePlan,
  duplicatePlan,
  deletePlan,
  switchActive,
  mapAllPlans,
  type PlansState,
} from './plans';
import { emptyPlan, DEFAULT_TERM } from './plan';
import { makeCourse, makePlan } from './fixtures';

const NOW = '2026-07-24T10:00:00.000Z';

function seeded(): PlansState {
  const s = migratePlans(null, makePlan(), NOW);
  return createPlan(s, NOW, 'Backup');
}

describe('migratePlans', () => {
  it('wraps a legacy single plan as the active "My plan"', () => {
    const legacy = makePlan();
    const s = migratePlans(null, legacy, NOW);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]!.name).toBe('My plan');
    expect(s.plans[0]!.plan).toEqual(legacy);
    expect(s.activeId).toBe(s.plans[0]!.id);
    expect(s.plans[0]!.createdAt).toBe(NOW);
  });

  it('starts fresh with an empty "My plan" when nothing is stored', () => {
    const s = migratePlans(null, null, NOW);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]!.plan.entries).toEqual([]);
  });

  it('passes an existing PlansState through, repairing a dangling activeId', () => {
    const existing = seeded();
    expect(migratePlans(existing, makePlan(), NOW)).toBe(existing);
    const dangling = { ...existing, activeId: 'nope' };
    const repaired = migratePlans(dangling, null, NOW);
    expect(repaired.activeId).toBe(existing.plans[0]!.id);
  });
});

describe('plan list operations', () => {
  it('createPlan appends an empty plan with a collision-free default name and activates it', () => {
    let s = migratePlans(null, makePlan(), NOW);
    s = createPlan(s, NOW); // "Plan 2"
    s = createPlan(s, NOW); // "Plan 3"
    expect(s.plans.map((p) => p.name)).toEqual(['My plan', 'Plan 2', 'Plan 3']);
    expect(activePlan(s).name).toBe('Plan 3');
    expect(activePlan(s).plan.entries).toEqual([]);
    // Term carries over from the previously active plan.
    expect(activePlan(s).plan.term).toEqual(DEFAULT_TERM);
  });

  it('addPlan stores a received plan under the given name and activates it', () => {
    const friend: PlanState = makePlan();
    const s = addPlan(migratePlans(null, null, NOW), friend, '朋友的plan', NOW);
    expect(s.plans.map((p) => p.name)).toEqual(['My plan', '朋友的plan']);
    expect(activePlan(s).name).toBe('朋友的plan');
    expect(activePlan(s).plan).toEqual(friend);
  });

  it('renamePlan renames only the target (trimmed, empty rejected)', () => {
    let s = seeded();
    const id = s.plans[0]!.id;
    s = renamePlan(s, id, '  主方案  ');
    expect(s.plans[0]!.name).toBe('主方案');
    expect(renamePlan(s, id, '   ')).toBe(s); // unchanged reference
  });

  it('duplicatePlan deep-ish copies the plan under "<name> copy" and activates it', () => {
    let s = migratePlans(null, makePlan(), NOW);
    const srcId = s.plans[0]!.id;
    s = duplicatePlan(s, srcId, NOW);
    expect(s.plans).toHaveLength(2);
    expect(activePlan(s).name).toBe('My plan copy');
    expect(activePlan(s).plan).toEqual(s.plans[0]!.plan);
    expect(activePlan(s).id).not.toBe(srcId);
    // Mutating the copy must not touch the source.
    const next = updateActivePlan(s, (p) => ({ ...p, entries: [] }), NOW);
    expect(next.plans[0]!.plan.entries.length).toBeGreaterThan(0);
  });

  it('deletePlan removes the target, falls back to the first remaining when active dies, and refuses the last one', () => {
    let s = seeded();
    const [first, second] = s.plans;
    expect(s.activeId).toBe(second!.id);
    s = deletePlan(s, second!.id);
    expect(s.plans).toHaveLength(1);
    expect(s.activeId).toBe(first!.id);
    expect(deletePlan(s, first!.id)).toBe(s); // last plan is kept
  });

  it('switchActive changes the active id only for known plans', () => {
    const s = seeded();
    const other = s.plans[0]!.id;
    expect(switchActive(s, other).activeId).toBe(other);
    expect(switchActive(s, 'ghost')).toBe(s);
  });

  it('updateActivePlan maps only the active plan and stamps updatedAt', () => {
    const s = seeded();
    const next = updateActivePlan(s, (p) => ({ ...p, entries: [] }), '2026-07-24T11:00:00.000Z');
    expect(activePlan(next).plan.entries).toEqual([]);
    expect(activePlan(next).updatedAt).toBe('2026-07-24T11:00:00.000Z');
    expect(next.plans[0]!.plan).toEqual(s.plans[0]!.plan);
    // No-op updater returns the same state reference.
    expect(updateActivePlan(s, (p) => p, NOW)).toBe(s);
  });

  it('mapAllPlans rewrites every plan (for cross-plan seat refreshes), keeping references when unchanged', () => {
    const s = seeded();
    expect(mapAllPlans(s, (p) => p, NOW)).toBe(s);
    const emptied = mapAllPlans(s, (p) => (p.entries.length ? { ...p, entries: [] } : p), NOW);
    expect(emptied.plans.every((n) => n.plan.entries.length === 0)).toBe(true);
  });
});

describe('storage round-trip', () => {
  it('savePlans/loadPlans round-trips; corrupt or foreign values load as null', async () => {
    const { savePlans, loadPlans } = await import('./storage');
    localStorage.clear();
    expect(loadPlans()).toBeNull();
    const s = seeded();
    savePlans(s);
    expect(loadPlans()).toEqual(s);
    localStorage.setItem('triton-planner:plans:v1', '{oops');
    expect(loadPlans()).toBeNull();
    localStorage.setItem('triton-planner:plans:v1', JSON.stringify({ activeId: 'x', plans: [{ id: 'x' }] }));
    expect(loadPlans()).toBeNull();
  });
});

describe('empty-state guard', () => {
  it('activePlan never throws even on a repaired state', () => {
    const s = migratePlans(null, null, NOW);
    expect(activePlan(s).plan).toEqual(emptyPlan(s.plans[0]!.plan.term));
    expect(makeCourse('X|2026|2')).toBeTruthy(); // fixture sanity, keeps import used
  });
});

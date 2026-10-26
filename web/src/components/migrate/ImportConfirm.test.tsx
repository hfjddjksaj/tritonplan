import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState, SyncOp, Term } from '@triton/shared';
import { ImportConfirm } from './ImportConfirm';
import { savePendingMigration, loadPendingMigration, MIGRATION_PENDING_KEY, type MigrationPayload } from '../../lib/migration';
import type { SendResult } from '../../lib/cloud/engine';
import type { WebSnapshot } from '../../lib/cloud/records';
import type { NamedPlan } from '../../lib/plans';
import type { TermsState } from '../../lib/terms-state';
import { makeCourse, makePlan } from '../../lib/fixtures';
import { snapshotOf } from '../../test/boot';

const mocks = vi.hoisted(() => ({ fetchState: vi.fn(), postSync: vi.fn(), batchOps: vi.fn() }));
vi.mock('../../lib/cloud/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/cloud/api')>()),
  fetchState: mocks.fetchState,
  postSync: mocks.postSync,
}));
vi.mock('../../lib/cloud/engine', async (orig) => {
  const mod = await orig<typeof import('../../lib/cloud/engine')>();
  mocks.batchOps.mockImplementation(mod.batchOps);
  return { ...mod, batchOps: mocks.batchOps };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
function terms(ids: string[]): TermsState {
  // Distinct content per plan so none is dropped as a duplicate of another.
  const plans: NamedPlan[] = ids.map((id, i) => {
    const c = makeCourse(`C${i}|2026|2`, `C${i}`);
    const plan: PlanState = { ...makePlan(), entries: [{ course: c, selectedOptionId: c.options[0]!.id, color: '120' }] };
    return { id, name: id, plan, createdAt: 'c', updatedAt: 'u', browsed: [] };
  });
  return { version: 1, activeTermKey: '2026|2', terms: { '2026|2': { term: FA, plans: { activeId: ids[0]!, plans } } } };
}
const payloadOf = (t: TermsState): MigrationPayload => ({
  kind: 'tritonplan-migration', version: 1, exportedAt: '2026-10-01T00:00:00.000Z',
  terms: t, plans: null, plan: null, pool: [], appt: null, received: null, hashPlan: null,
});

let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();
const text = () => container.textContent ?? '';
async function render(snapshot: WebSnapshot, payload: MigrationPayload) {
  await act(async () => root.render(<ImportConfirm snapshot={snapshot} payload={payload} onDone={onDone} />));
}
async function click(label: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => { el.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const ok: SendResult = { ok: true, versions: { terms: {}, plans: {} } };
const sentOps = (from = 0) => (mocks.postSync.mock.calls.slice(from) as SyncOp[][][]).flatMap((c) => c[0] ?? []);
const planIds = (ops: SyncOp[]) => ops.flatMap((o) => (o.op === 'putPlan' ? [o.planId] : [])).sort();

beforeEach(() => {
  localStorage.clear();
  mocks.fetchState.mockReset();
  mocks.postSync.mockReset();
  onDone.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/migrate');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe('ImportConfirm', () => {
  it('confirming posts the merged ops and clears the pending payload', async () => {
    const payload = payloadOf(terms(['p1', 'p2']));
    savePendingMigration(payload);
    const empty = snapshotOf();
    mocks.fetchState.mockResolvedValue(empty);
    mocks.postSync.mockResolvedValue(ok);
    await render(empty, payload);
    expect(text()).toContain('We found 2 plans in 1 term from the old TritonPlan.');
    await click('Add to my account');
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    expect(planIds(sentOps())).toEqual(['p1', 'p2']);
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(onDone).toHaveBeenCalledWith({ kind: 'imported', plans: 2 });
  });

  it('a failed import keeps the pending payload and says so', async () => {
    const payload = payloadOf(terms(['p1']));
    savePendingMigration(payload);
    mocks.fetchState.mockResolvedValue(snapshotOf());
    mocks.postSync.mockResolvedValue({ ok: false, kind: 'conflict' });
    await render(snapshotOf(), payload);
    await click('Add to my account');
    expect(text()).toContain("Couldn't add your plans. Please try again.");
    expect(loadPendingMigration()).toEqual(payload);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('nothing new to add shows "already in your account" and OK clears the payload', async () => {
    const t = terms(['p1']);
    const payload = payloadOf(t);
    savePendingMigration(payload);
    await render(snapshotOf(t), payload);
    expect(text()).toContain('These plans are already in your account.');
    expect(text()).not.toContain('Add to my account');
    await click('OK');
    expect(loadPendingMigration()).toBeNull();
    expect(onDone).toHaveBeenCalledWith({ kind: 'cleared' });
    expect(mocks.postSync).not.toHaveBeenCalled();
  });

  it('batch 1 ok, batch 2 fails: Try again re-fetches and sends only what is left', async () => {
    const payload = payloadOf(terms(['p1', 'p2']));
    savePendingMigration(payload);
    const server = snapshotOf();
    mocks.fetchState.mockImplementation(async () => structuredClone(server));
    // One op per request, so the first request commits part of the import.
    mocks.batchOps.mockImplementation((ops: SyncOp[]) => ops.map((o) => [o]));
    let calls = 0;
    mocks.postSync.mockImplementation(async (ops: SyncOp[]) => {
      calls++;
      if (calls === 3) return { ok: false, kind: 'network' };
      for (const o of ops) {
        if (o.op === 'putTerm') server.terms[o.termKey] = { version: 7, data: o.data as never };
        if (o.op === 'putPlan') server.plans[o.planId] = { version: 8, termKey: o.termKey, data: o.data as NamedPlan };
      }
      return ok;
    });
    await render(snapshotOf(), payload);
    await click('Add to my account');
    expect(text()).toContain("Couldn't add your plans. Please try again.");
    expect(calls).toBe(3); // stopped at the first failure
    await click('Try again');
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    const retry = sentOps(3);
    expect(retry.filter((o) => o.op === 'putTerm')).toHaveLength(0);
    expect(planIds(retry)).toHaveLength(1);
    expect(onDone).toHaveBeenCalledWith({ kind: 'imported', plans: 1 });
  });

  it('Discard asks twice; Keep backs out, Discard clears', async () => {
    const payload = payloadOf(terms(['p1']));
    savePendingMigration(payload);
    await render(snapshotOf(), payload);
    await click('Discard…');
    expect(text()).toContain('Discard the plans from the old site? They stay on the old site, so you can move them again later.');
    await click('Keep');
    expect(loadPendingMigration()).toEqual(payload);
    expect(text()).toContain('Add to my account');
    await click('Discard…');
    await click('Discard');
    expect(loadPendingMigration()).toBeNull();
    expect(onDone).toHaveBeenCalledWith({ kind: 'cleared' });
  });

  it('Not now keeps the payload', async () => {
    const payload = payloadOf(terms(['p1']));
    savePendingMigration(payload);
    await render(snapshotOf(), payload);
    await click('Not now');
    expect(loadPendingMigration()).toEqual(payload);
    expect(onDone).toHaveBeenCalledWith({ kind: 'later' });
  });
});

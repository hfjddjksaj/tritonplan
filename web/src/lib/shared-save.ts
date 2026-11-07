/**
 * "Save to my plans" on a shared plan's page: the picked courses go straight into the visitor's
 * account, as a new plan or in place of one of theirs, without leaving the page. The page has no
 * planner of its own, so it reads the account, writes the change through a sync engine of its own
 * that lives for this one save, and tells any open planner tab to pick it up.
 */
import type { CourseOffering, PlanState, SyncOp, Term } from '@triton/shared';
import { mergeCourses } from './bridge';
import { fetchMe, fetchState, postSync, UnauthorizedError } from './cloud/api';
import { createSyncEngine, type SendResult } from './cloud/engine';
import { termsFromSnapshot, type WebSnapshot } from './cloud/records';
import { freeSharedName, switchActive } from './plans';
import { adoptPlanIn, replacePlanEntriesIn, updateWorkspace, type TermsState } from './terms-state';
import { termKey } from './terms';

/** `plan` holds only the picked courses, on the sections the shared plan shows. */
export type SharedSave = {
  plan: PlanState;
  mode: { kind: 'new'; name: string } | { kind: 'replace'; planId: string };
};
export type SharedSaveOutcome = { kind: 'new' | 'replaced'; planName: string };
export type SharedSaveResult =
  | { ok: true; outcome: SharedSaveOutcome }
  | { ok: false; reason: 'signed-out' | 'offline' | 'failed' };

/**
 * The account with the save applied. The plan on show in each term stays the one on show: a
 * planner open in another tab must not switch under the student because a friend's plan came in.
 */
export function applySharedSave(
  terms: TermsState | null,
  pool: CourseOffering[],
  save: SharedSave,
  now: Date,
): { terms: TermsState; pool: CourseOffering[]; outcome: SharedSaveOutcome } {
  const iso = now.toISOString();
  const key = termKey(save.plan.term);
  const nextPool = mergeCourses(pool, save.plan.entries.map((e) => e.course));
  if (terms && save.mode.kind === 'replace') {
    const { planId } = save.mode;
    const replaced = replacePlanEntriesIn(terms, planId, save.plan, iso);
    const target = terms.terms[key]?.plans.plans.find((p) => p.id === planId);
    if (replaced && target) return { terms: replaced, pool: nextPool, outcome: { kind: 'replaced', planName: target.name } };
    // Deleted on another device since the dialog listed it: the picked courses are saved all the same.
  }
  const before = terms?.terms[key];
  const name = freeSharedName(before?.plans.plans.map((p) => p.name) ?? [], save.mode.kind === 'new' ? save.mode.name : '');
  let next = adoptPlanIn(terms ?? { version: 1, activeTermKey: key, terms: {} }, save.plan, name, iso);
  if (terms) next = { ...next, activeTermKey: terms.activeTermKey };
  if (before) next = updateWorkspace(next, key, (ps) => switchActive(ps, before.plans.activeId));
  return { terms: next, pool: nextPool, outcome: { kind: 'new', planName: name } };
}

/** The visitor's plans in `term`, for "Replace a plan". 'signed-out' when there is no session; null when they could not be read. */
export async function loadMyPlans(
  term: Term,
  deps: { fetchMe: typeof fetchMe; fetchState: typeof fetchState } = { fetchMe, fetchState },
): Promise<{ id: string; name: string }[] | null | 'signed-out'> {
  try {
    if ((await deps.fetchMe()) === null) return 'signed-out';
    const ws = termsFromSnapshot(await deps.fetchState())?.terms[termKey(term)];
    return ws ? ws.plans.plans.map((p) => ({ id: p.id, name: p.name })) : [];
  } catch (err) {
    return err instanceof UnauthorizedError ? 'signed-out' : null;
  }
}

/**
 * Write the save into the account. The engine starts from a fresh read, so it sends only this
 * save's changes, at the versions the server holds now; it is disposed whatever happens, because a
 * page that is not a planner must not keep retrying in the background.
 */
export async function saveSharedToAccount(
  save: SharedSave,
  deps: {
    fetchState?: () => Promise<WebSnapshot>;
    postSync?: (ops: SyncOp[]) => Promise<SendResult>;
    now?: () => Date;
  } = {},
): Promise<SharedSaveResult> {
  const read = deps.fetchState ?? fetchState;
  let snapshot: WebSnapshot;
  try {
    snapshot = await read();
  } catch (err) {
    return { ok: false, reason: err instanceof UnauthorizedError ? 'signed-out' : 'offline' };
  }
  const engine = createSyncEngine({ snapshot, send: deps.postSync ?? postSync });
  let outcome: SharedSaveOutcome;
  try {
    const next = applySharedSave(termsFromSnapshot(snapshot), snapshot.pool, save, (deps.now ?? (() => new Date()))());
    outcome = next.outcome;
    engine.setTerms(next.terms);
    engine.setPool(next.pool);
    await engine.flush();
    const status = engine.status();
    if (status !== 'idle') {
      return { ok: false, reason: status === 'signed-out' ? 'signed-out' : status === 'offline' ? 'offline' : 'failed' };
    }
  } finally {
    engine.dispose();
  }
  notifyAccountChanged();
  return { ok: true, outcome };
}

/** Written after every save from a shared page; open planner tabs listen for it (a `storage` event) and reload the account. */
export const ACCOUNT_CHANGED_KEY = 'triton-planner:account-changed:v1';

export function notifyAccountChanged(): void {
  try {
    localStorage.setItem(ACCOUNT_CHANGED_KEY, String(Date.now()));
  } catch {
    /* storage blocked: an open planner sees the save on its next refocus instead */
  }
}

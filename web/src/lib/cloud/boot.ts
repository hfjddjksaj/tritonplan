/**
 * What the planner starts from once signed in: the account, the server
 * snapshot assembled into planner state, and the sync engine that owns saving
 * it. One boot per mounted App; replacing the boot means disposing its engine.
 */
import type { ApptTimes, CourseOffering, PlanState, SyncOp } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { mirrorTokenFromHash, planFromHash, tokenFromHash } from '../share';
import { postSync, type Me } from './api';
import { createSyncEngine, type SendResult, type SyncEngine } from './engine';
import { termsFromSnapshot, type WebSnapshot } from './records';

/** Someone's plan to keep as a new plan of this account: they chose "Save to my account" before signing in. */
export interface AdoptPlan {
  name: string;
  plan: PlanState;
}

export interface CloudBoot {
  me: Me;
  snapshot: WebSnapshot;
  engine: SyncEngine;
  terms: TermsState | null;
  pool: CourseOffering[];
  appt: ApptTimes[] | null;
  /** Saved into the plans as the planner starts, so the click they made before signing in is not asked for again. */
  adopt?: AdoptPlan;
}

/** `send` is a test seam; the app always saves through POST /api/sync. */
export function makeBoot(
  me: Me,
  snapshot: WebSnapshot,
  send: (ops: SyncOp[]) => Promise<SendResult> = postSync,
): CloudBoot {
  return {
    me,
    snapshot,
    engine: createSyncEngine({ snapshot, send }),
    terms: termsFromSnapshot(snapshot),
    pool: snapshot.pool,
    appt: snapshot.appt,
  };
}

/**
 * A share link (#p=) or mirror (#m=) opened while signed out. sessionStorage,
 * because Google sign-in leaves the page and returnTo carries only a path.
 */
export const PENDING_HASH_KEY = 'triton-planner:pending-hash:v1';

export const carriesPlan = (hash: string): boolean => tokenFromHash(hash) !== null || mirrorTokenFromHash(hash) !== null;

export function stashPendingHash(hash: string): void {
  if (!carriesPlan(hash)) return;
  try {
    sessionStorage.setItem(PENDING_HASH_KEY, hash);
  } catch {
    /* storage blocked: the link is lost after a Google round trip, nothing worse */
  }
}

/**
 * Put a stashed link back into the address bar for usePlan to consume, then
 * forget it. replaceState, not location.hash: no history entry, no hashchange.
 * A plan link the address bar already carries is newer than the stash.
 */
export function restorePendingHash(): void {
  let stashed: string | null = null;
  try {
    stashed = sessionStorage.getItem(PENDING_HASH_KEY);
    sessionStorage.removeItem(PENDING_HASH_KEY);
  } catch {
    return;
  }
  if (!stashed || carriesPlan(window.location.hash)) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search + stashed);
}

/** Forget a stashed link, and any save asked for on one, without restoring it: a short link opened since is the newer one. */
export function dropPendingHash(): void {
  try {
    sessionStorage.removeItem(PENDING_HASH_KEY);
    sessionStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    /* storage blocked: nothing was stashed either */
  }
}

/**
 * "Save to my account" on a #p= link: the link itself, kept in this tab so the
 * plan is saved, not just shown, once signed in. Unlike a short link it cannot
 * be fetched again, so it does not outlive the tab (the confirm mail's tab
 * gets the plain sign-in).
 */
export const PENDING_SAVE_KEY = 'triton-planner:pending-save:v1';

export function stashPendingSave(hash: string): void {
  try {
    sessionStorage.setItem(PENDING_SAVE_KEY, hash);
  } catch {
    /* storage blocked: the link still opens after sign-in, it just waits for its own Save click */
  }
}

/** The #p= link Save was asked for and its plan, consumed with the link's own stash; null if none (or it does not decode). */
export function takePendingSave(): { hash: string; plan: PlanState } | null {
  let hash: string | null;
  try {
    hash = sessionStorage.getItem(PENDING_SAVE_KEY);
  } catch {
    return null;
  }
  if (hash === null) return null;
  dropPendingHash();
  const plan = planFromHash(hash);
  return plan ? { hash, plan } : null;
}

/**
 * A short link (/s/<code>) whose visitor chose "Save to my account" while
 * signed out. returnTo brings Google and a same-tab sign-in back to the link;
 * the confirm mail opens in another tab and lands on "/", so this is
 * localStorage, read by whichever tab signs in first. After a day it is a
 * visit the student walked away from, not one they are finishing.
 */
export const PENDING_SHARE_KEY = 'triton-planner:pending-share:v1';
const PENDING_SHARE_MAX_AGE_MS = 24 * 3_600_000;

export function stashPendingShare(code: string, now: Date = new Date()): void {
  try {
    localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({ code, at: now.toISOString() }));
  } catch {
    /* storage blocked: the link still comes back through returnTo, just not through the confirm mail */
  }
}

/**
 * The stashed code if it is under a day old; an older or damaged entry is dropped.
 * A live one stays until clearPendingShare: a fetch that fails must leave it for the
 * next load, its age still counted from the click.
 */
export function peekPendingShare(now: number = Date.now()): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_SHARE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let code: string | null = null;
  try {
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown } | null;
    // NaN (a bad date) fails the age test too.
    if (typeof v?.code === 'string' && typeof v.at === 'string' && now - Date.parse(v.at) <= PENDING_SHARE_MAX_AGE_MS) {
      code = v.code;
    }
  } catch {
    /* not JSON: dropped below */
  }
  if (code === null) clearPendingShare();
  return code;
}

export function clearPendingShare(): void {
  try {
    localStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    /* storage blocked: nothing was stashed either */
  }
}

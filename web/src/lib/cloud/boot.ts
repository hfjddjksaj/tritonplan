/**
 * What the planner starts from once signed in: the account, the server
 * snapshot assembled into planner state, and the sync engine that owns saving
 * it. One boot per mounted App; replacing the boot means disposing its engine.
 */
import type { ApptTimes, CourseOffering, PlanState, SyncOp } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { mirrorTokenFromHash, tokenFromHash } from '../share';
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
  adopt?: AdoptPlan[];
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

/** Forget a stashed link without restoring it: a short link opened since is the newer one. */
export function dropPendingHash(): void {
  try {
    sessionStorage.removeItem(PENDING_HASH_KEY);
  } catch {
    /* storage blocked: nothing was stashed either */
  }
}

/**
 * The "Save to my account" this tab clicked while signed out: a short link's
 * code, or the shown plan of an old #p= link (which cannot be fetched again).
 * It outlives the confirm mail's tab saving the same link, so this tab can tell
 * "I asked for this" from "this was only opened" when it sees the sign-in.
 */
export type SaveIntent = { code: string } | { hash: string };
export const PENDING_SAVE_KEY = 'triton-planner:pending-save:v1';

export function stashPendingSave(intent: SaveIntent, now: Date = new Date()): void {
  try {
    sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ ...intent, at: now.toISOString() }));
  } catch {
    /* storage blocked: a short link still has its localStorage stash; a #p= link waits for its own Save click */
  }
}

/** This tab's Save if under a day old, as short links' stash; an older or damaged one is dropped. */
export function peekPendingSave(now: number = Date.now()): SaveIntent | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(PENDING_SAVE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let intent: SaveIntent | null = null;
  try {
    const v = JSON.parse(raw) as { code?: unknown; hash?: unknown; at?: unknown } | null;
    if (typeof v?.at === 'string' && now - Date.parse(v.at) <= PENDING_SHARE_MAX_AGE_MS) {
      if (typeof v.code === 'string') intent = { code: v.code };
      else if (typeof v.hash === 'string') intent = { hash: v.hash };
    }
  } catch {
    /* not JSON: dropped below */
  }
  if (intent === null) clearPendingSave();
  return intent;
}

export function clearPendingSave(): void {
  try {
    sessionStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    /* storage blocked: nothing was stashed either */
  }
}

/**
 * Every Save still waiting: this tab's own, and the short link another tab left
 * for the confirm mail (when it is a different link). Viewing other links never
 * cancels one; only saving it, its link being turned off, or a day passing does.
 */
export function pendingSaves(): SaveIntent[] {
  const own = peekPendingSave();
  const code = peekPendingShare();
  const out: SaveIntent[] = own ? [own] : [];
  if (code !== null && !(own && 'code' in own && own.code === code)) out.push({ code });
  return out;
}

/** A short link turned off: any Save waiting on it goes with it. */
export function forgetSaves(code: string): void {
  if (peekPendingShare() === code) clearPendingShare();
  const own = peekPendingSave();
  if (own && 'code' in own && own.code === code) clearPendingSave();
}

/** The Saves just honored are done; a newer one stashed meanwhile (another tab) stays. */
export function consumeSaves(done: SaveIntent[]): void {
  const own = peekPendingSave();
  if (own && done.some((d) => JSON.stringify(d) === JSON.stringify(own))) clearPendingSave();
  const code = peekPendingShare();
  if (code !== null && done.some((d) => 'code' in d && d.code === code)) clearPendingShare();
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

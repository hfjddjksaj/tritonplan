/**
 * What the planner starts from once signed in: the account, the server
 * snapshot assembled into planner state, and the sync engine that owns saving
 * it. One boot per mounted App; replacing the boot means disposing its engine.
 */
import type { ApptTimes, CourseOffering, SyncOp } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { mirrorTokenFromHash, tokenFromHash } from '../share';
import { postSync, type Me } from './api';
import { createSyncEngine, type SendResult, type SyncEngine } from './engine';
import { termsFromSnapshot, type WebSnapshot } from './records';

export interface CloudBoot {
  me: Me;
  snapshot: WebSnapshot;
  engine: SyncEngine;
  terms: TermsState | null;
  pool: CourseOffering[];
  appt: ApptTimes[] | null;
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

/** The stashed code if it is under a day old. Forgotten either way: one sign-in uses it once. */
export function takePendingShare(now: number = Date.now()): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_SHARE_KEY);
    localStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    return null;
  }
  try {
    const v = JSON.parse(raw ?? 'null') as { code?: unknown; at?: unknown } | null;
    if (typeof v?.code !== 'string' || typeof v.at !== 'string') return null;
    return now - Date.parse(v.at) <= PENDING_SHARE_MAX_AGE_MS ? v.code : null; // NaN (a bad date) fails too
  } catch {
    return null;
  }
}

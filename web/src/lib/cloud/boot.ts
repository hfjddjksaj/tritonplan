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

const carriesPlan = (hash: string): boolean => tokenFromHash(hash) !== null || mirrorTokenFromHash(hash) !== null;

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

/**
 * What the planner starts from once signed in: the account, the server
 * snapshot assembled into planner state, and the sync engine that owns saving
 * it. One boot per mounted App; replacing the boot means disposing its engine.
 */
import type { ApptTimes, CourseOffering, SyncOp } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { mirrorTokenFromHash } from '../share';
import { postSync, type Me } from './api';
import { createSyncEngine, idleEngine, type SendResult, type SyncEngine } from './engine';
import { termsFromSnapshot, type WebSnapshot } from './records';

export interface CloudBoot {
  /** Null: signed out. The planner shows what the extension brings and asks for sign-in before any edit. */
  me: Me | null;
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

/** The planner for a visitor who is not signed in: a new account's empty start, saved nowhere. */
export function makeGuestBoot(): CloudBoot {
  return {
    me: null,
    snapshot: { terms: {}, plans: {}, pool: [], appt: null },
    engine: idleEngine(),
    terms: null,
    pool: [],
    appt: null,
  };
}

/**
 * An own-plan mirror (#m=) opened while signed out. sessionStorage, because
 * Google sign-in leaves the page and returnTo carries only a path. An old #p=
 * link is not kept: it no longer opens.
 */
export const PENDING_HASH_KEY = 'triton-planner:pending-hash:v1';

const isMirror = (hash: string): boolean => mirrorTokenFromHash(hash) !== null;

export function stashPendingHash(hash: string): void {
  if (!isMirror(hash)) return;
  try {
    sessionStorage.setItem(PENDING_HASH_KEY, hash);
  } catch {
    /* storage blocked: the mirror is lost after a Google round trip, nothing worse */
  }
}

/**
 * Put a stashed mirror back into the address bar for usePlan to consume, then
 * forget it. replaceState, not location.hash: no history entry, no hashchange.
 * A mirror the address bar already carries is newer than the stash.
 */
export function restorePendingHash(): void {
  let stashed: string | null = null;
  try {
    stashed = sessionStorage.getItem(PENDING_HASH_KEY);
    sessionStorage.removeItem(PENDING_HASH_KEY);
  } catch {
    return;
  }
  if (!stashed || isMirror(window.location.hash)) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search + stashed);
}

/**
 * A short link (/s/<code>) whose visitor chose "Save to my plans" while
 * signed out. returnTo brings Google and a same-tab sign-in back to the link's
 * save dialog; the confirm mail opens in another tab and lands on "/", which
 * sends it on to the link, so this is localStorage, read by whichever tab signs
 * in first. After a day it is a visit the student walked away from, not one
 * they are finishing.
 */
export const PENDING_SHARE_KEY = 'triton-planner:pending-share:v1';
const PENDING_SHARE_MAX_AGE_MS = 24 * 3_600_000;
const fresh = (at: string, now: number): boolean => now - Date.parse(at) <= PENDING_SHARE_MAX_AGE_MS; // NaN fails too

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
  return readPendingShare(now)?.code ?? null;
}

function readPendingShare(now: number): { code: string; at: string } | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_SHARE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let stash: { code: string; at: string } | null = null;
  try {
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown } | null;
    if (typeof v?.code === 'string' && typeof v.at === 'string' && fresh(v.at, now)) stash = { code: v.code, at: v.at };
  } catch {
    /* not JSON: dropped below */
  }
  if (stash === null) clearPendingShare();
  return stash;
}

export function clearPendingShare(): void {
  try {
    localStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    /* storage blocked: nothing was stashed either */
  }
}

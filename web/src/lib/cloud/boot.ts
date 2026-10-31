/**
 * What the planner starts from once signed in: the account, the server
 * snapshot assembled into planner state, and the sync engine that owns saving
 * it. One boot per mounted App; replacing the boot means disposing its engine.
 */
import type { ApptTimes, CourseOffering, PlanState, SyncOp } from '@triton/shared';
import type { TermsState } from '../terms-state';
import { mirrorTokenFromHash, tokenFromHash } from '../share';
import { postSync, type Me } from './api';
import { createSyncEngine, idleEngine, type SendResult, type SyncEngine } from './engine';
import { termsFromSnapshot, type WebSnapshot } from './records';

/** Someone's plan to keep as a new plan of this account: they chose "Save to my account" before signing in. */
export interface AdoptPlan {
  name: string;
  plan: PlanState;
}

export interface CloudBoot {
  /** Null: signed out. The planner shows what the extension brings and asks for sign-in before any edit. */
  me: Me | null;
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
 * Every "Save to my account" this tab clicked while signed out: a short link's
 * code, or the shown plan of an old #p= link (which cannot be fetched again).
 * They outlive the confirm mail's tab saving the same link, so this tab can tell
 * "I asked for this" from "this was only opened" when it sees the sign-in.
 */
export type SaveIntent = { code: string } | { hash: string };
type StampedSave = SaveIntent & { at: string };
export const PENDING_SAVE_KEY = 'triton-planner:pending-save:v1';

const sameSave = (a: SaveIntent, b: SaveIntent): boolean =>
  'code' in a ? 'code' in b && a.code === b.code : 'hash' in b && a.hash === b.hash;
const fresh = (at: string, now: number): boolean => now - Date.parse(at) <= PENDING_SHARE_MAX_AGE_MS; // NaN fails too

/** This tab's Saves under a day old, as short links' stash; older or damaged ones are dropped. */
function readOwnSaves(now: number): StampedSave[] {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(PENDING_SAVE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  const list: StampedSave[] = [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* not JSON: dropped below */
  }
  if (Array.isArray(parsed)) {
    for (const v of parsed as { code?: unknown; hash?: unknown; at?: unknown }[]) {
      if (typeof v?.at !== 'string' || !fresh(v.at, now)) continue;
      if (typeof v.code === 'string') list.push({ code: v.code, at: v.at });
      else if (typeof v.hash === 'string') list.push({ hash: v.hash, at: v.at });
    }
  }
  if (!Array.isArray(parsed) || list.length !== parsed.length) writeOwnSaves(list);
  return list;
}

function writeOwnSaves(list: StampedSave[]): void {
  try {
    if (list.length === 0) sessionStorage.removeItem(PENDING_SAVE_KEY);
    else sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: a short link still has its localStorage stash; a #p= link waits for its own Save click */
  }
}

/** Add a Save to this tab's list; clicking the same one again only renews its time. */
export function stashPendingSave(intent: SaveIntent, now: Date = new Date()): void {
  const list = readOwnSaves(now.getTime()).filter((s) => !sameSave(s, intent));
  writeOwnSaves([...list, { ...intent, at: now.toISOString() } as StampedSave]);
}

export function peekPendingSaves(now: number = Date.now()): SaveIntent[] {
  return readOwnSaves(now).map(({ at: _, ...intent }) => intent as SaveIntent);
}

/**
 * Short links some tab has already saved: code → when, kept a day. A tab whose
 * own Save for that link is older drops it, even after the copy was edited or
 * deleted. A Save clicked after that time is a new one and still counts.
 */
export const SAVED_SHARES_KEY = 'triton-planner:saved-shares:v1';

function readSavedShares(now: number): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_SHARES_KEY) ?? '{}') as Record<string, unknown> | null;
    const out: Record<string, string> = {};
    for (const [code, at] of Object.entries(v ?? {})) if (typeof at === 'string' && fresh(at, now)) out[code] = at;
    return out;
  } catch {
    return {};
  }
}

function markSharesSaved(codes: string[], now: Date): void {
  if (codes.length === 0) return;
  const saved = readSavedShares(now.getTime());
  for (const code of codes) saved[code] = now.toISOString();
  try {
    localStorage.setItem(SAVED_SHARES_KEY, JSON.stringify(saved));
  } catch {
    /* storage blocked: the stashes are blocked too, so no other tab holds a Save for it */
  }
}

/**
 * Every Save still waiting: this tab's own, and the short link another tab left
 * for the confirm mail (when it is a different link). Viewing other links never
 * cancels one; only saving it (here or in another tab), its link being turned
 * off, or a day passing does. `alreadySaved`: this tab's short-link Saves that
 * another tab has honored since; they are dropped here.
 */
export function pendingSaves(now: number = Date.now()): { intents: SaveIntent[]; alreadySaved: string[] } {
  const saved = readSavedShares(now);
  const done = (code: string, at: string) => saved[code] !== undefined && saved[code] >= at;
  const own = readOwnSaves(now);
  const alreadySaved: string[] = [];
  const keep = own.filter((s) => {
    if (!('code' in s) || !done(s.code, s.at)) return true;
    alreadySaved.push(s.code);
    return false;
  });
  if (keep.length !== own.length) writeOwnSaves(keep);
  const intents = keep.map(({ at: _, ...intent }) => intent as SaveIntent);
  const stash = readPendingShare(now);
  if (stash && done(stash.code, stash.at)) clearPendingShare();
  else if (stash && !intents.some((s) => 'code' in s && s.code === stash.code)) intents.push({ code: stash.code });
  return { intents, alreadySaved };
}

/** A short link turned off: any Save waiting on it goes with it. */
export function forgetSaves(code: string): void {
  if (peekPendingShare() === code) clearPendingShare();
  const own = readOwnSaves(Date.now());
  const rest = own.filter((s) => !('code' in s && s.code === code));
  if (rest.length !== own.length) writeOwnSaves(rest);
}

/** The Saves just honored are done, and their short links marked saved for other tabs; one stashed meanwhile stays. */
export function consumeSaves(done: SaveIntent[], now: Date = new Date()): void {
  const own = readOwnSaves(now.getTime());
  const rest = own.filter((s) => !done.some((d) => sameSave(d, s)));
  if (rest.length !== own.length) writeOwnSaves(rest);
  const code = peekPendingShare(now.getTime());
  if (code !== null && done.some((d) => 'code' in d && d.code === code)) clearPendingShare();
  markSharesSaved(done.flatMap((d) => ('code' in d ? [d.code] : [])), now);
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

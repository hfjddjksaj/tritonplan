/**
 * Portable plans: JSON export/import + a shareable URL that carries the whole plan
 * in the location hash, lz-string-compressed so it stays URL-safe and compact.
 */
import LZString from 'lz-string';
import type { PlanState } from '@triton/shared';
import { isPlanState } from './storage';

const HASH_KEY = 'p';

/** Compress a plan into a URL-safe token. */
export function encodePlan(plan: PlanState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(plan));
}

/** Inverse of encodePlan. Returns null on any corruption. */
export function decodePlan(token: string): PlanState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(token);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    return isPlanState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Build a `#p=…` hash fragment (without the leading `#`). */
export function planToHash(plan: PlanState): string {
  return `${HASH_KEY}=${encodePlan(plan)}`;
}

/** Read a plan out of a raw location hash string ("#p=…" or "p=…"). */
export function planFromHash(hash: string): PlanState | null {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!clean) return null;
  const params = new URLSearchParams(clean);
  const token = params.get(HASH_KEY);
  if (!token) return null;
  return decodePlan(token);
}

/** A full absolute URL that restores this plan when opened. */
export function shareUrl(plan: PlanState, base = window.location.href): string {
  const url = new URL(base);
  url.hash = planToHash(plan);
  return url.toString();
}

/** Trigger a browser download of the plan as a .json file. */
export function downloadPlanJson(plan: PlanState): void {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `triton-plan-${plan.term.year}-${plan.term.period}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse an imported JSON string into a PlanState, or null if invalid. */
export function parsePlanJson(text: string): PlanState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlanState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keeps Rate My Professors working in a Chinese-language browser.
 *
 * RMP's cookie banner (OneTrust) stores consent in `OptanonConsent`, and its
 * `datestamp` is `new Date().toString()`: in a zh-CN browser that ends in
 * "GMT-0700 (北美太平洋夏令时间)". RMP's server answers every request carrying
 * such a cookie with a 503 "Something went wrong" page. So the first visit
 * works, OneTrust writes the cookie, and from then on every professor page and
 * every "Load more ratings" fails. Verified 2026-10-30: the same cookie with
 * "(Pacific Daylight Time)" gets 200, with the Chinese name 503.
 *
 * The repair drops the parenthesised time-zone name: nobody reads it, and
 * "Fri Oct 30 2026 22:58:38 GMT-0700" still parses as the same instant. It
 * runs in RMP's own page (content/rmp-consent.ts), touches that one cookie and
 * nothing else, and the value never leaves the page. Not through chrome.cookies:
 * Chromium 153 hides non-Secure cookies like this one from `getAll` and from
 * change events (measured 2026-10-30), so a background repair never sees it.
 *
 * ⛔ NO-BAN RED LINE: nothing here touches TSS.
 */
import { RMP_CONSENT_COOKIE, RMP_COOKIE_DOMAIN } from '../config.js';

/** A non-ASCII character, raw or as the escaped UTF-8 bytes (≥ %80) the cookie stores it as. */
const NON_ASCII = /%[89a-f][0-9a-f]|[^\x00-\x7f]/i;
const NON_ASCII_ALL = /%[89a-f][0-9a-f]|[^\x00-\x7f]/gi;

/** The repaired value, or null when there is nothing to repair. */
export function repairConsentValue(value: string): string | null {
  if (!NON_ASCII.test(value)) return null;
  const fixed = value
    // "+(北美太平洋夏令时间)" → "", but an ASCII "(…)" stays as OneTrust wrote it.
    .replace(/\+?\([^()&]*\)/g, (group) => (NON_ASCII.test(group) ? '' : group))
    // Anything non-ASCII left elsewhere would trip the server the same way.
    .replace(NON_ASCII_ALL, '');
  return fixed === value ? null : fixed;
}

/**
 * A `document.cookie = "…"` assignment with a consent value repaired; every other
 * assignment, and every attribute after the value, passes through untouched.
 */
export function repairCookieAssignment(assignment: string): string {
  const prefix = `${RMP_CONSENT_COOKIE}=`;
  if (!assignment.startsWith(prefix)) return assignment;
  const end = assignment.indexOf(';');
  const value = assignment.slice(prefix.length, end === -1 ? undefined : end);
  const fixed = repairConsentValue(value);
  return fixed === null ? assignment : prefix + fixed + (end === -1 ? '' : assignment.slice(end));
}

/** The minimal document the page side needs, so tests can hand in a fake. */
export interface CookieDocument {
  cookie: string;
}

/**
 * Repair a consent cookie already stored (written before the extension watched,
 * or in a tab it didn't run in). True when it rewrote one: the request for the
 * page now showing still carried the bad value, so the caller reloads once.
 * Written back the way OneTrust writes it: site-wide, a year, SameSite=Lax.
 */
export function repairStoredConsent(doc: CookieDocument, now: Date): boolean {
  const prefix = `${RMP_CONSENT_COOKIE}=`;
  const stored = doc.cookie.split('; ').find((c) => c.startsWith(prefix));
  if (!stored) return false;
  const fixed = repairConsentValue(stored.slice(prefix.length));
  if (fixed === null) return false;
  const expires = new Date(now.getTime() + 365 * 864e5).toUTCString();
  doc.cookie = `${prefix}${fixed}; domain=.${RMP_COOKIE_DOMAIN}; path=/; expires=${expires}; SameSite=Lax`;
  return true;
}

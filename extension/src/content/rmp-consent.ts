/**
 * Runs in Rate My Professors' MAIN world at document_start, so that OneTrust's
 * consent cookie never carries a time-zone name RMP's server fails on (the whole
 * story is in lib/rmp-consent.ts).
 *
 *  1. Every `document.cookie = "OptanonConsent=…"` the page makes is repaired on
 *     the way in; all other cookie reads and writes go straight through.
 *  2. A bad cookie already stored is repaired, and the page reloads once: the
 *     request for it went out with the bad value, so what loaded is RMP's
 *     "Something went wrong" page. A session flag stops a second reload.
 *
 * ⛔ NO-BAN RED LINE: this runs on ratemyprofessors.com only, never on TSS. It
 * makes no request, reads no other cookie, and sends nothing anywhere.
 */
import { repairCookieAssignment, repairStoredConsent } from '../lib/rmp-consent.js';

const RELOADED = 'tritonplan:rmp-consent-reloaded';

function hookCookieWrites(): void {
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (!desc?.get || !desc.set) return;
  const { get, set } = desc;
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    enumerable: desc.enumerable ?? true,
    get() {
      return get.call(this);
    },
    set(v: unknown) {
      set.call(this, typeof v === 'string' ? repairCookieAssignment(v) : v);
    },
  });
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

hookCookieWrites();
if (repairStoredConsent(document, new Date())) {
  const s = session();
  if (s && !s.getItem(RELOADED)) {
    s.setItem(RELOADED, '1');
    location.reload();
  }
} else {
  session()?.removeItem(RELOADED);
}

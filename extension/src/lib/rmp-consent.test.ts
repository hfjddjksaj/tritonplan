import { describe, expect, it } from 'vitest';
import { repairConsentValue, repairCookieAssignment, repairStoredConsent } from './rmp-consent';

/** OneTrust's cookie exactly as a zh-CN Chrome stored it on RMP (2026-10-30). */
const ZH =
  'isGpcEnabled=0&datestamp=Fri+Oct+30+2026+22%3A58%3A38+GMT-0700+(%E5%8C%97%E7%BE%8E%E5%A4%AA%E5%B9%B3%E6%B4%8B%E5%A4%8F%E4%BB%A4%E6%97%B6%E9%97%B4)&version=202512.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=910e4696-4f51-4119-8db0-82f31fcfc7fc&interactionCount=0&isAnonUser=1&landingPath=https%3A%2F%2Fwww.ratemyprofessors.com%2Fprofessor%2F1664307&groups=C0002%3A0%2CC0003%3A0%2CC0001%3A1%2CC0004%3A0';
const FIXED = ZH.replace('+(%E5%8C%97%E7%BE%8E%E5%A4%AA%E5%B9%B3%E6%B4%8B%E5%A4%8F%E4%BB%A4%E6%97%B6%E9%97%B4)', '');
/** The same from an English browser: RMP accepts it, so it is left exactly as written. */
const EN = ZH.replace(/\(%E5[^)]*\)/, '(Pacific+Daylight+Time)');
const ATTRS = '; expires=Sat, 30 Oct 2027 05:58:38 GMT; path=/; Samesite=Lax; domain=.ratemyprofessors.com';

describe('repairConsentValue', () => {
  it('drops the non-ASCII time-zone name and nothing else', () => {
    expect(repairConsentValue(ZH)).toBe(FIXED);
    expect(FIXED).toContain('datestamp=Fri+Oct+30+2026+22%3A58%3A38+GMT-0700&version=');
    // what is left still names the same instant
    const stamp = decodeURIComponent(/datestamp=([^&]*)/.exec(FIXED)![1]!.replace(/\+/g, ' '));
    expect(new Date(stamp).toISOString()).toBe('2026-10-31T05:58:38.000Z');
  });

  it('leaves an all-ASCII value alone', () => {
    expect(repairConsentValue(EN)).toBeNull();
    expect(repairConsentValue(FIXED)).toBeNull();
  });

  it('strips non-ASCII anywhere else, raw or escaped', () => {
    expect(repairConsentValue('a=1&tz=(東京)&b=%C3%A9x')).toBe('a=1&tz=&b=x');
  });
});

describe('repairCookieAssignment', () => {
  it("repairs OneTrust's write, keeping its attributes", () => {
    expect(repairCookieAssignment(`OptanonConsent=${ZH}${ATTRS}`)).toBe(`OptanonConsent=${FIXED}${ATTRS}`);
    expect(repairCookieAssignment(`OptanonConsent=${ZH}`)).toBe(`OptanonConsent=${FIXED}`);
  });

  it('passes every other assignment through untouched', () => {
    for (const a of [`OptanonConsent=${EN}${ATTRS}`, `_ga=GA1.2.3${ATTRS}`, `x=(東京)`, `OptanonAlertBoxClosed=2026-10-30T05:58:38Z`]) {
      expect(repairCookieAssignment(a)).toBe(a);
    }
  });
});

/** document.cookie in miniature: reads show `name=value` pairs, writes set one by name. */
function jar(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    writes,
    get cookie() {
      return [...values].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(a: string) {
      writes.push(a);
      const [pair] = a.split(';');
      const i = pair!.indexOf('=');
      values.set(pair!.slice(0, i), pair!.slice(i + 1));
    },
  };
}

describe('repairStoredConsent', () => {
  const NOW = new Date('2026-10-31T06:00:00Z');

  it('rewrites a stored bad cookie site-wide for a year, and says so', () => {
    const doc = jar({ _ga: 'GA1', OptanonConsent: ZH, AWSALB: 'x' });
    expect(repairStoredConsent(doc, NOW)).toBe(true);
    expect(doc.writes).toEqual([
      `OptanonConsent=${FIXED}; domain=.ratemyprofessors.com; path=/; expires=Sun, 31 Oct 2027 06:00:00 GMT; SameSite=Lax`,
    ]);
    expect(doc.cookie).toBe(`_ga=GA1; OptanonConsent=${FIXED}; AWSALB=x`);
  });

  it('writes nothing when the cookie is fine or absent', () => {
    for (const doc of [jar({ OptanonConsent: EN }), jar({ OptanonConsent: FIXED }), jar({ _ga: 'GA1' }), jar({})]) {
      expect(repairStoredConsent(doc, NOW)).toBe(false);
      expect(doc.writes).toEqual([]);
    }
  });
});

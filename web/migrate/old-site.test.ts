import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeCourse } from '../src/lib/fixtures';
import { encodePlan } from '../src/lib/share';
import { isMigrationPayload, MIGRATE_MSG, type MigrationPayload } from '../src/lib/migration';
import { SITE_ORIGIN } from '../src/lib/site';
import { runOldSite } from './old-site';

const NOW = '2026-10-26T15:00:00.000Z';
const FALL = { year: '2026', period: '2', label: 'Fall 2026' };

function planState() {
  const c = makeCourse('PHYS-2A|2026|2', 'PHYS-2A', 4);
  return { version: 1, term: FALL, entries: [{ course: c, selectedOptionId: null }] };
}

interface FakeWin extends EventTarget {
  location: { hash: string; replace: ReturnType<typeof vi.fn> };
  open: ReturnType<typeof vi.fn>;
}
function fakeWin(hash = ''): FakeWin {
  const w = new EventTarget() as FakeWin;
  w.location = { hash, replace: vi.fn() };
  w.open = vi.fn();
  return w;
}
function fakeTab() {
  return { postMessage: vi.fn(), closed: false };
}
function send(w: FakeWin, data: unknown, origin: string, source: unknown) {
  const e = new Event('message');
  Object.assign(e, { data, origin, source });
  w.dispatchEvent(e);
}
function run(w: FakeWin) {
  return runOldSite(document, w as unknown as Window, NOW);
}
const text = () => document.body.textContent ?? '';
const btn = (label: string) =>
  [...document.querySelectorAll('button, a')].find((e) => e.textContent === label) as HTMLElement | undefined;

// jsdom has no object-URL support; the page uses the global URL, as a browser page does.
const urlFns = { createObjectURL: vi.fn((_b?: Blob) => 'blob:x'), revokeObjectURL: vi.fn() };
let clickSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  urlFns.createObjectURL.mockReset().mockReturnValue('blob:x');
  urlFns.revokeObjectURL.mockReset();
  Object.assign(URL, urlFns);
  document.body.innerHTML = '<div id="app"></div>';
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  clickSpy.mockRestore();
  vi.useRealTimers();
});

function seedPlans() {
  localStorage.setItem('triton-planner:plan:v1', JSON.stringify(planState()));
}

describe('old site migration page', () => {
  test('a #p= share link is forwarded to the new site untouched', () => {
    const w = fakeWin('#p=abc123');
    expect(run(w)).toBeNull(); // nothing for main.ts to draw behind a page that is leaving
    expect(w.location.replace).toHaveBeenCalledWith(SITE_ORIGIN + '/#p=abc123');
    expect(text()).not.toContain('has moved');
  });

  test('#m= is not forwarded; it feeds the payload', () => {
    const token = encodePlan(planState() as never, 'full');
    const w = fakeWin('#m=' + token);
    run(w);
    expect(w.location.replace).not.toHaveBeenCalled();
    expect(text()).toContain('This browser has 1 saved plan.');
  });

  test('plans found → move button; none found → plain link to the new site', () => {
    const w0 = fakeWin();
    run(w0);
    expect(text()).toContain('TritonPlan has moved to tritonplan.cn');
    expect(text()).toContain('Sign in on the new site with Google or with your email.');
    expect(text()).toContain(
      'After the TritonPlan extension updates, Chrome may switch it off until you allow its new site. ' +
        'If the + TritonPlan button disappears from TSS, open chrome://extensions and turn TritonPlan back on.',
    );
    expect(text()).not.toContain('will update itself');
    expect(btn('Move my plans to tritonplan.cn')).toBeUndefined();
    expect(btn('Download a backup file')).toBeUndefined();
    expect((btn('Go to tritonplan.cn') as HTMLAnchorElement).href).toBe(SITE_ORIGIN + '/');

    document.body.innerHTML = '<div id="app"></div>';
    seedPlans();
    expect(run(fakeWin())?.plan?.entries).toHaveLength(1); // what main.ts draws behind the card
    expect(text()).toContain('This browser has 1 saved plan.');
    expect(btn('Move my plans to tritonplan.cn')).toBeDefined();
    expect(btn('Download a backup file')).toBeDefined();
    expect(btn('Go to tritonplan.cn')).toBeUndefined();
  });

  test("answers the new tab's ready with the payload, only for that tab and origin", () => {
    seedPlans();
    const w = fakeWin();
    const tab = fakeTab();
    w.open.mockReturnValue(tab);
    run(w);
    btn('Move my plans to tritonplan.cn')!.click();
    expect(w.open).toHaveBeenCalledWith(SITE_ORIGIN + '/migrate?handoff=1', '_blank');
    expect(tab.postMessage).not.toHaveBeenCalled(); // never unprompted

    const ready = { type: MIGRATE_MSG.ready };
    send(w, ready, 'https://evil.example', tab);
    send(w, ready, SITE_ORIGIN, fakeTab());
    send(w, { type: 'other' }, SITE_ORIGIN, tab);
    send(w, null, SITE_ORIGIN, tab);
    expect(tab.postMessage).not.toHaveBeenCalled();

    send(w, ready, SITE_ORIGIN, tab);
    expect(tab.postMessage).toHaveBeenCalledTimes(1);
    const [msg, target] = tab.postMessage.mock.calls[0]!;
    expect(target).toBe(SITE_ORIGIN);
    expect(msg.type).toBe(MIGRATE_MSG.payload);
    expect(isMigrationPayload(msg.payload)).toBe(true);

    // a reloaded receiver asks again and gets it again
    send(w, ready, SITE_ORIGIN, tab);
    expect(tab.postMessage).toHaveBeenCalledTimes(2);

    expect(text()).not.toContain('Done');
    send(w, { type: MIGRATE_MSG.ack }, 'https://evil.example', tab);
    expect(text()).not.toContain('Done');
    send(w, { type: MIGRATE_MSG.ack }, SITE_ORIGIN, tab);
    expect(text()).toContain('Done — finish in the new tab.');
  });

  test('the listener is attached before the tab is opened, and a second click starts a fresh handshake', () => {
    seedPlans();
    const w = fakeWin();
    const add = vi.spyOn(w, 'addEventListener');
    const tabs = [fakeTab(), fakeTab()];
    w.open.mockImplementationOnce(() => {
      expect(add).toHaveBeenCalledWith('message', expect.any(Function));
      return tabs[0];
    });
    w.open.mockImplementationOnce(() => tabs[1]);
    run(w);
    btn('Move my plans to tritonplan.cn')!.click();
    send(w, { type: MIGRATE_MSG.ack }, SITE_ORIGIN, tabs[0]);
    btn('Move my plans to tritonplan.cn')!.click();
    send(w, { type: MIGRATE_MSG.ready }, SITE_ORIGIN, tabs[0]); // stale tab is ignored
    expect(tabs[0]!.postMessage).not.toHaveBeenCalled();
    send(w, { type: MIGRATE_MSG.ready }, SITE_ORIGIN, tabs[1]);
    expect(tabs[1]!.postMessage).toHaveBeenCalledTimes(1);
  });

  test('a blocked pop-up explains itself and offers the backup file', () => {
    seedPlans();
    const w = fakeWin();
    w.open.mockReturnValue(null);
    run(w);
    btn('Move my plans to tritonplan.cn')!.click();
    expect(text()).toContain(
      'Your browser blocked the new tab. Allow pop-ups for this page, or download a backup file and import it on tritonplan.cn.',
    );
    expect(btn('Download a backup file')).toBeDefined();
  });

  test('the backup file is the payload JSON, dated locally, and round-trips the receiver check', async () => {
    vi.useFakeTimers();
    seedPlans();
    const w = fakeWin();
    let blob: Blob | undefined;
    urlFns.createObjectURL.mockImplementation((b?: Blob) => {
      blob = b;
      return 'blob:x';
    });
    let name = '';
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    run(w);
    btn('Download a backup file')!.click();
    const d = new Date(NOW);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(name).toBe(`tritonplan-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`);
    expect(urlFns.revokeObjectURL).not.toHaveBeenCalled(); // Safari needs the URL alive while it starts the download
    vi.advanceTimersByTime(60_000);
    expect(urlFns.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers(); // jsdom's FileReader needs real timers
    const raw = await new Promise<string>((res) => {
      const r = new FileReader(); // jsdom's Blob has no text()
      r.onload = () => res(String(r.result));
      r.readAsText(blob!);
    });
    const parsed = JSON.parse(raw) as MigrationPayload;
    expect(isMigrationPayload(parsed)).toBe(true);
    expect(parsed.exportedAt).toBe(NOW);
    expect(parsed.plan).toEqual(planState());
    expect(document.querySelector('a[download]')).toBeNull(); // temporary anchor removed
  });

  test('every legacy key is byte-identical after a full run, backup, move, ready and ack', () => {
    const fall = planState();
    const entry = { id: 'p1', name: 'My plan', createdAt: NOW, updatedAt: NOW, plan: fall };
    const plans = { activeId: 'p1', plans: [entry] };
    const seed: Record<string, string> = {
      'triton-planner:terms:v1': JSON.stringify({
        version: 1, activeTermKey: '2026-2', terms: { '2026-2': { term: FALL, plans } },
      }),
      'triton-planner:plans:v1': JSON.stringify(plans),
      'triton-planner:plan:v1': JSON.stringify(fall),
      'triton-planner:pool:v1': JSON.stringify([fall.entries[0]!.course]),
      'triton-planner:appt:v1': JSON.stringify([]),
      'triton-planner:received:v1': JSON.stringify({ plan: fall, source: 'link', receivedAt: NOW }),
      'triton-planner:cal-view:v1': '"week"',
      'triton-planner:map-booked-only:v1': 'true',
      'triton-planner:sample-purged:v1': '1',
      'triton-planner:synced-hash:v1': 'abc',
      unrelated: 'x',
    };
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    const w = fakeWin('#m=' + encodePlan(fall as never, 'full'));
    const tab = fakeTab();
    w.open.mockReturnValue(tab);
    run(w);
    btn('Download a backup file')!.click();
    btn('Move my plans to tritonplan.cn')!.click();
    send(w, { type: MIGRATE_MSG.ready }, SITE_ORIGIN, tab);
    send(w, { type: MIGRATE_MSG.ack }, SITE_ORIGIN, tab);
    expect(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))).toEqual(seed);
  });

  test('an ack from the right origin but another window is ignored', () => {
    seedPlans();
    const w = fakeWin();
    const tab = fakeTab();
    w.open.mockReturnValue(tab);
    run(w);
    btn('Move my plans to tritonplan.cn')!.click();
    send(w, { type: MIGRATE_MSG.ack }, SITE_ORIGIN, fakeTab());
    expect(text()).not.toContain('Done');
  });

  test('says it is opening the new site until the ack arrives', () => {
    seedPlans();
    const w = fakeWin();
    const tab = fakeTab();
    w.open.mockReturnValue(tab);
    run(w);
    btn('Move my plans to tritonplan.cn')!.click();
    expect(text()).toContain('Opening tritonplan.cn…');
    send(w, { type: MIGRATE_MSG.ack }, SITE_ORIGIN, tab);
    expect(text()).not.toContain('Opening');
  });

  test('a single plan reads "1 saved plan."', () => {
    seedPlans();
    run(fakeWin());
    expect(text()).toContain('This browser has 1 saved plan.');
  });

  test('unreadable storage still renders the move and backup buttons', () => {
    seedPlans();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      run(fakeWin());
    } finally {
      spy.mockRestore();
    }
    expect(text()).toContain('TritonPlan has moved to tritonplan.cn');
    expect(btn('Go to tritonplan.cn') ?? btn('Move my plans to tritonplan.cn')).toBeDefined();
  });

  test('never posts to a wildcard origin', () => {
    seedPlans();
    const w = fakeWin();
    const tab = fakeTab();
    w.open.mockReturnValue(tab);
    run(w);
    btn('Move my plans to tritonplan.cn')!.click();
    send(w, { type: MIGRATE_MSG.ready }, SITE_ORIGIN, tab);
    expect(tab.postMessage.mock.calls.every((c) => c[1] === SITE_ORIGIN)).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import type { TermsState } from '../lib/terms-state';
import type { Me } from '../lib/cloud/api';
import { AccountMenu } from './AccountMenu';
import { CalendarDialog } from './CalendarDialog';
import { menuOptions, menuPick, menuSelects, menuValue } from '../test/menu-select';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const term = (year: string, period: string): Term => ({ year, period, label: '' }) as Term;
const ws = (t: Term, plans: [string, string][]) => ({
  term: t,
  plans: { activeId: plans[0]?.[0] ?? '', plans: plans.map(([id, name]) => ({ id, name, plan: { entries: [] } })) },
});
// Fall 2026 (two plans, on screen) and Winter 2026 (one) are open; Fall 2025 is archived; a fourth term has no plan at all.
const terms = {
  version: 1,
  activeTermKey: '2026|2',
  terms: {
    '2025|2': ws(term('2025', '2'), [['old', 'Old plan']]),
    '2026|2': ws(term('2026', '2'), [['a', 'Plan A'], ['b', 'Plan B']]),
    '2026|3': ws(term('2026', '3'), [['w', 'Winter plan']]),
    '2027|1': ws(term('2027', '1'), []),
  },
} as unknown as TermsState;

const HTTPS = 'https://tritonplan.cn/cal/secret.ics';
const WEBCAL = 'webcal://tritonplan.cn/cal/secret.ics';
const linked = { https: HTTPS, webcal: WEBCAL };
const unlinked = { https: null, webcal: null };

let container: HTMLDivElement;
let root: Root;
let answers: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;
const flash = vi.fn();
const onClose = vi.fn();
const onChanged = vi.fn();

const cal = (over: Record<string, unknown> = {}) => () =>
  json(200, { ...linked, terms: { '2026|2': 'a', '2026|3': 'w' }, missing: [], ...over });

beforeEach(() => {
  // Which terms count as open or archived depends on today's date; pin it to mid-October 2026 (Fall 2026 under way).
  // Only Date is faked, so promises and timers behave normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15));
  flash.mockClear();
  onClose.mockClear();
  onChanged.mockClear();
  answers = { 'GET /api/calendar': cal() };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    (answers[`${init?.method ?? 'GET'} ${url}`] ?? (() => json(500, { error: 'server' })))(),
  );
  vi.stubGlobal('fetch', fetchMock);
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function renderDialog(on: TermsState = terms) {
  await act(async () => {
    root.render(<CalendarDialog terms={on} onClose={onClose} onFlash={flash} onChanged={onChanged} />);
    await settle();
  });
}
const me: Me = { email: 's@ucsd.edu', hasPassword: true, hasGoogle: false };
async function renderMenu() {
  await act(async () => {
    root.render(<AccountMenu me={me} terms={terms} sharePlans={[]} onFlash={flash} flush={async () => {}} />);
    await settle();
  });
}
const btns = (t: string) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === t);
async function click(el: HTMLElement) {
  await act(async () => { el.click(); await settle(); });
}
const text = () => document.body.querySelector('[role="dialog"]')!.textContent!;
const selects = () => menuSelects(document.body.querySelector('[role="dialog"]')!);
async function pick(sel: HTMLButtonElement, value: string) {
  menuPick(sel, value);
  await act(async () => { await settle(); });
}
const puts = () =>
  fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
const options = (sel: HTMLButtonElement) => menuOptions(sel).map((o) => o.label);

describe('CalendarDialog', () => {
  it('shows the title and the explanation', async () => {
    await renderDialog();
    expect(text()).toContain('Calendar subscription');
    expect(text()).toContain(
      "Each term is a calendar of its own. It shows the classes, midterms and finals of the plan you pick for it, and empties once the term's finals are over.",
    );
  });

  it('picks for the term on screen only, offering its plans and Not in calendar', async () => {
    await renderDialog();
    expect(selects()).toHaveLength(1);
    expect(text()).toContain('Fall 2026');
    expect(text()).not.toContain('Winter 2026');
    expect(text()).not.toContain('Fall 2025');
    expect(options(selects()[0]!)).toEqual(['Not in calendar', 'Plan A', 'Plan B']);
    expect(menuValue(selects()[0]!)).toBe('a');
  });

  it('switching term in the topbar is how another term is picked', async () => {
    await renderDialog({ ...terms, activeTermKey: '2026|3' });
    expect(text()).toContain('Winter 2026');
    expect(text()).not.toContain('Fall 2026');
    expect(options(selects()[0]!)).toEqual(['Not in calendar', 'Winter plan']);
    expect(menuValue(selects()[0]!)).toBe('w');
  });

  it('a term on screen that is over offers no pick and says why', async () => {
    await renderDialog({ ...terms, activeTermKey: '2025|2' });
    expect(selects()).toHaveLength(0);
    expect(text()).toContain('Fall 2025 is over. A term that is over is no longer in calendars.');
  });

  it('with no link yet, offers to create one and shows it afterwards', async () => {
    answers['GET /api/calendar'] = cal({ ...unlinked });
    answers['POST /api/calendar/link'] = () => json(200, linked);
    await renderDialog();
    expect(document.body.querySelector('a[href^="webcal://"]')).toBeNull();
    await click(btns('Create my calendar link')[0]!);
    expect(document.body.querySelector<HTMLAnchorElement>('a[href^="webcal://"]')!.textContent).toContain(
      'Apple Calendar',
    );
    expect(btns('Create my calendar link')).toHaveLength(0);
    expect(onChanged).toHaveBeenCalled();
  });

  it('Apple is the webcal:// link, Google opens its add page, and the https:// link can still be copied', async () => {
    await renderDialog();
    const a = document.body.querySelector<HTMLAnchorElement>('a[href^="webcal://"]')!;
    // Fall 2026's own feed: subscribing to one term never brings another along.
    expect(a.getAttribute('href')).toBe('webcal://tritonplan.cn/cal/secret/2026-2.ics');
    expect(text()).toContain('Add Fall 2026 to');
    expect(a.textContent).toContain('Apple Calendar');
    expect(text()).toContain(
      "Each opens the app to subscribe. Changes show up in Apple Calendar within an hour; Google Calendar can take several hours to a day, and that can't be sped up.",
    );
    const g = [...document.body.querySelectorAll('a')].find((e) => e.textContent?.includes('Google Calendar'))!;
    expect(g.getAttribute('href')).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2Ftritonplan\.cn%2Fcal%2Fsecret%2F2026-2\.ics%3Fv%3D[a-z0-9]+$/,
    );
    expect(g.getAttribute('target')).toBe('_blank');
    await click(btns('Copy the link')[0]!);
    expect(writeText).toHaveBeenCalledWith('https://tritonplan.cn/cal/secret/2026-2.ics');
    expect(flash).toHaveBeenCalledWith('Calendar link copied.');
  });

  it('changing a term PUTs the whole map, and Not in calendar drops the key', async () => {
    answers['PUT /api/calendar'] = () => json(200, { ok: true });
    await renderDialog();
    await pick(selects()[0]!, 'b');
    // Winter's pick is not on screen, and still goes along untouched.
    expect(puts()).toEqual([{ terms: { '2026|2': 'b', '2026|3': 'w' } }]);
    expect(menuValue(selects()[0]!)).toBe('b');
    await pick(selects()[0]!, '');
    expect(puts()[1]).toEqual({ terms: { '2026|3': 'w' } });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a failed save says so and puts the select back', async () => {
    await renderDialog();
    await pick(selects()[0]!, 'b');
    expect(text()).toContain("Couldn't save. Please try again.");
    expect(menuValue(selects()[0]!)).toBe('a');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('the term on screen with no pick asks for one', async () => {
    answers['GET /api/calendar'] = cal({ terms: { '2026|3': 'w' } });
    await renderDialog();
    expect(text()).toContain('Pick a plan to add Fall 2026 to your calendar.');
  });

  it('another term with no pick is not asked about here', async () => {
    answers['GET /api/calendar'] = cal({ terms: { '2026|2': 'a' } });
    await renderDialog();
    expect(text()).not.toContain('Pick a plan to add');
  });

  it('a deleted pick says so and reads Not in calendar until picked again', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2026|2'] });
    answers['PUT /api/calendar'] = () => json(200, { ok: true });
    await renderDialog();
    expect(text()).toContain('The plan you picked for Fall 2026 was deleted — pick another.');
    expect(menuValue(selects()[0]!)).toBe('');
    await pick(selects()[0]!, 'b');
    expect(text()).not.toContain('was deleted');
  });

  it('a missing key for a term that is not on screen is ignored', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2026|3'], terms: { '2026|2': 'a', '2026|3': 'w' } });
    await renderDialog();
    expect(text()).not.toContain('was deleted');
  });

  it('Reset asks first, and Keep sends nothing', async () => {
    await renderDialog();
    await click(btns('Reset link')[0]!);
    expect(text()).toContain("Your old links stop working right away, and you'll need to subscribe to each term again.");
    await click(btns('Keep')[0]!);
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/calendar/reset')).toBe(false);
    expect(btns('Reset link')).toHaveLength(1);
  });

  it('confirming Reset swaps in the new link', async () => {
    answers['POST /api/calendar/reset'] = () =>
      json(200, { https: 'https://tritonplan.cn/cal/new.ics', webcal: 'webcal://tritonplan.cn/cal/new.ics' });
    await renderDialog();
    await click(btns('Reset link')[0]!);
    await click(btns('Reset')[0]!);
    expect(document.body.querySelector('a[href^="webcal://"]')!.getAttribute('href')).toBe(
      'webcal://tritonplan.cn/cal/new/2026-2.ics',
    );
    await click(btns('Copy the link')[0]!);
    expect(writeText).toHaveBeenCalledWith('https://tritonplan.cn/cal/new/2026-2.ics');
  });

  it('a failed load says so', async () => {
    answers['GET /api/calendar'] = () => json(500, {});
    await renderDialog();
    expect(text()).toContain("Couldn't load your calendar settings.");
  });
});

describe('AccountMenu calendar item', () => {
  const dot = () => document.body.querySelector('.menu__dot');
  const open = () => act(async () => { document.body.querySelector<HTMLElement>('button[aria-haspopup="menu"]')!.click(); });

  it('has a dot when the term on screen has no pick', async () => {
    answers['GET /api/calendar'] = cal({ terms: { '2026|3': 'w' } });
    await renderMenu();
    await open();
    expect(btns('Calendar subscription')).toHaveLength(1);
    expect(dot()).not.toBeNull();
  });

  it('has no dot when only a term off screen has no pick', async () => {
    answers['GET /api/calendar'] = cal({ terms: { '2026|2': 'a' } });
    await renderMenu();
    await open();
    expect(dot()).toBeNull();
  });

  it('has no dot without a calendar link, even with an unpicked term', async () => {
    answers['GET /api/calendar'] = cal({ ...unlinked, terms: {} });
    await renderMenu();
    await open();
    expect(dot()).toBeNull();
  });

  it('shows the dot once the link is created in the dialog while a term is unpicked', async () => {
    let made = false;
    answers['GET /api/calendar'] = () =>
      json(200, { ...(made ? linked : unlinked), terms: { '2026|3': 'w' }, missing: [] });
    answers['POST /api/calendar/link'] = () => { made = true; return json(200, linked); };
    await renderMenu();
    await open();
    expect(dot()).toBeNull();
    await click(btns('Calendar subscription')[0]!);
    await click(btns('Create my calendar link')[0]!);
    await click(document.body.querySelector<HTMLElement>('[role="dialog"] button[aria-label="Close"]')!);
    await open();
    expect(dot()).not.toBeNull();
  });

  it('has a dot when the pick on screen is missing', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2026|2'] });
    await renderMenu();
    await open();
    expect(dot()).not.toBeNull();
  });

  it('has no dot when the term on screen is picked, even if another term is missing', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2026|3'] });
    await renderMenu();
    await open();
    expect(dot()).toBeNull();
  });

  it('fetches the calendar on mount and on opening the menu (Share may have changed a pick), not on every render', async () => {
    await renderMenu();
    await renderMenu();
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/calendar')).toHaveLength(1);
    await open();
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/calendar')).toHaveLength(2);
  });

  it('opens the dialog from the menu', async () => {
    await renderMenu();
    await open();
    await click(btns('Calendar subscription')[0]!);
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('Apple Calendar');
  });
});

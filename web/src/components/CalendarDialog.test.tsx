import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import type { TermsState } from '../lib/terms-state';
import type { Me } from '../lib/cloud/api';
import { AccountMenu } from './AccountMenu';
import { CalendarDialog } from './CalendarDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const term = (year: string, period: string): Term => ({ year, period, label: '' }) as Term;
const ws = (t: Term, plans: [string, string][]) => ({
  term: t,
  plans: { activeId: plans[0]?.[0] ?? '', plans: plans.map(([id, name]) => ({ id, name, plan: { entries: [] } })) },
});
// Fall 2026 (two plans) and Winter 2026 (one) are open; Fall 2025 is archived; a fourth term has no plan at all.
const terms = {
  version: 1,
  activeTermKey: '2026|2',
  terms: {
    '2025|2': ws(term('2025', '2'), [['old', 'Old plan']]),
    '2026|2': ws(term('2026', '2'), [['a', 'Plan A'], ['b', 'Plan B']]),
    '2027|3': ws(term('2027', '3'), [['w', 'Winter plan']]),
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
  json(200, { ...linked, terms: { '2026|2': 'a', '2027|3': 'w' }, missing: [], ...over });

beforeEach(() => {
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
});

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function renderDialog() {
  await act(async () => {
    root.render(<CalendarDialog terms={terms} onClose={onClose} onFlash={flash} onChanged={onChanged} />);
    await settle();
  });
}
const me: Me = { email: 's@ucsd.edu', hasPassword: true, hasGoogle: false };
async function renderMenu() {
  await act(async () => {
    root.render(<AccountMenu me={me} terms={terms} onFlash={flash} flush={async () => {}} />);
    await settle();
  });
}
const btns = (t: string) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === t);
async function click(el: HTMLElement) {
  await act(async () => { el.click(); await settle(); });
}
const text = () => document.body.querySelector('[role="dialog"]')!.textContent!;
const selects = () => [...document.body.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')];
async function pick(sel: HTMLSelectElement, value: string) {
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  });
}
const puts = () =>
  fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
const options = (sel: HTMLSelectElement) => [...sel.options].map((o) => o.textContent);

describe('CalendarDialog', () => {
  it('shows the title and the explanation', async () => {
    await renderDialog();
    expect(text()).toContain('Calendar subscription');
    expect(text()).toContain(
      'Pick one plan per term. Your calendar shows the classes, midterms and finals of the plans you pick, and drops a term once its finals are over.',
    );
  });

  it('lists only open terms that have plans, each with its plans and Not in calendar', async () => {
    await renderDialog();
    expect(selects()).toHaveLength(2);
    expect(text()).toContain('Fall 2026');
    expect(text()).toContain('Winter 2026');
    expect(text()).not.toContain('Fall 2025');
    expect(options(selects()[0]!)).toEqual(['Not in calendar', 'Plan A', 'Plan B']);
    expect(selects()[0]!.value).toBe('a');
  });

  it('with no link yet, offers to create one and shows it afterwards', async () => {
    answers['GET /api/calendar'] = cal({ ...unlinked });
    answers['POST /api/calendar/link'] = () => json(200, linked);
    await renderDialog();
    expect(btns('Subscribe in Apple Calendar')).toHaveLength(0);
    await click(btns('Create my calendar link')[0]!);
    expect(document.body.querySelector<HTMLAnchorElement>('a[href^="webcal://"]')!.textContent).toBe(
      'Subscribe in Apple Calendar',
    );
    expect(btns('Create my calendar link')).toHaveLength(0);
    expect(onChanged).toHaveBeenCalled();
  });

  it('Apple is the webcal:// link; Google copies the https:// one', async () => {
    await renderDialog();
    const a = document.body.querySelector<HTMLAnchorElement>('a[href^="webcal://"]')!;
    expect(a.getAttribute('href')).toBe(WEBCAL);
    expect(a.textContent).toBe('Subscribe in Apple Calendar');
    await click(btns('Copy link for Google Calendar')[0]!);
    expect(writeText).toHaveBeenCalledWith(HTTPS);
    expect(flash).toHaveBeenCalledWith('Calendar link copied.');
    expect(text()).toContain(
      'In Google Calendar on a computer: Other calendars → + → From URL → paste the link → Add calendar.',
    );
    expect(text()).toContain(
      "Apple Calendar picks up changes within an hour. Google Calendar can take several hours to a day — it can't be sped up.",
    );
  });

  it('changing a term PUTs the whole map, and Not in calendar drops the key', async () => {
    answers['PUT /api/calendar'] = () => json(200, { ok: true });
    await renderDialog();
    await pick(selects()[0]!, 'b');
    expect(puts()).toEqual([{ terms: { '2026|2': 'b', '2027|3': 'w' } }]);
    expect(selects()[0]!.value).toBe('b');
    await pick(selects()[1]!, '');
    expect(puts()[1]).toEqual({ terms: { '2026|2': 'b' } });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a failed save says so and puts the select back', async () => {
    await renderDialog();
    await pick(selects()[0]!, 'b');
    expect(text()).toContain("Couldn't save. Please try again.");
    expect(selects()[0]!.value).toBe('a');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('a term with no pick asks for one', async () => {
    answers['GET /api/calendar'] = cal({ terms: { '2026|2': 'a' } });
    await renderDialog();
    expect(text()).toContain('Pick a plan to add Winter 2026 to your calendar.');
    expect(text()).not.toContain('Pick a plan to add Fall 2026 to your calendar.');
  });

  it('a deleted pick says so and reads Not in calendar until picked again', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2026|2'] });
    answers['PUT /api/calendar'] = () => json(200, { ok: true });
    await renderDialog();
    expect(text()).toContain('The plan you picked for Fall 2026 was deleted — pick another.');
    expect(selects()[0]!.value).toBe('');
    await pick(selects()[0]!, 'b');
    expect(text()).not.toContain('was deleted');
  });

  it('a missing key for a term that is not listed is ignored', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2025|2'], terms: { '2025|2': 'old', '2026|2': 'a', '2027|3': 'w' } });
    await renderDialog();
    expect(text()).not.toContain('was deleted');
  });

  it('Reset asks first, and Keep sends nothing', async () => {
    await renderDialog();
    await click(btns('Reset link')[0]!);
    expect(text()).toContain("Your old link stops working right away, and you'll need to subscribe again.");
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
      'webcal://tritonplan.cn/cal/new.ics',
    );
    await click(btns('Copy link for Google Calendar')[0]!);
    expect(writeText).toHaveBeenCalledWith('https://tritonplan.cn/cal/new.ics');
  });

  it('a failed load says so', async () => {
    answers['GET /api/calendar'] = () => json(500, {});
    await renderDialog();
    expect(text()).toContain("Couldn't load your calendar settings.");
  });
});

describe('AccountMenu calendar item', () => {
  const dot = () => document.body.querySelector('.acctmenu__dot');
  const open = () => act(async () => { document.body.querySelector<HTMLElement>('button[aria-haspopup="menu"]')!.click(); });

  it('has a dot when a listed term has no pick', async () => {
    answers['GET /api/calendar'] = cal({ terms: { '2026|2': 'a' } });
    await renderMenu();
    await open();
    expect(btns('Calendar subscription')).toHaveLength(1);
    expect(dot()).not.toBeNull();
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
      json(200, { ...(made ? linked : unlinked), terms: { '2026|2': 'a' }, missing: [] });
    answers['POST /api/calendar/link'] = () => { made = true; return json(200, linked); };
    await renderMenu();
    await open();
    expect(dot()).toBeNull();
    await click(btns('Calendar subscription')[0]!);
    await click(btns('Create my calendar link')[0]!);
    await click(btns('Close')[0]!);
    await open();
    expect(dot()).not.toBeNull();
  });

  it('has a dot when a pick is missing', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2027|3'] });
    await renderMenu();
    await open();
    expect(dot()).not.toBeNull();
  });

  it('has no dot when every listed term is picked, even if an unlisted term is missing', async () => {
    answers['GET /api/calendar'] = cal({ missing: ['2025|2'] });
    await renderMenu();
    await open();
    expect(dot()).toBeNull();
  });

  it('fetches the calendar once, not on every render', async () => {
    await renderMenu();
    await renderMenu();
    await open();
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/calendar')).toHaveLength(1);
  });

  it('opens the dialog from the menu', async () => {
    await renderMenu();
    await open();
    await click(btns('Calendar subscription')[0]!);
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('Subscribe in Apple Calendar');
  });
});

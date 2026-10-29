import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import { googleCalendarUrl } from '../lib/cloud/api';
import { ShareMenu } from './ShareMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const FA: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const HTTPS = 'https://tritonplan.cn/api/cal/secret.ics';
const WEBCAL = 'webcal://tritonplan.cn/api/cal/secret.ics';
const PLANS = [
  { id: 'plan-1', name: 'Mine', count: 1 },
  { id: 'plan-2', name: 'Backup', count: 0 },
];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
/** What GET /api/calendar answers. */
let calendar: () => Response;
const flash = vi.fn();
const flush = vi.fn(async () => {});
// jsdom cannot follow webcal:// or open a new tab; the handlers under test still run. Capture phase: the
// dialog stops clicks inside it from bubbling to its backdrop, and so to the document.
const noFollow = (e: Event) => e.preventDefault();

beforeEach(() => {
  flash.mockClear();
  flush.mockClear();
  calendar = () => json(200, { https: null, webcal: null, terms: { '2027|0': 'winter-plan' }, missing: [] });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${url}`;
    if (route === 'GET /api/calendar') return calendar();
    if (route === 'PUT /api/calendar') return json(200, { ok: true });
    if (route === 'POST /api/calendar/link') return json(200, { https: HTTPS, webcal: WEBCAL });
    return json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  document.addEventListener('click', noFollow, true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.removeEventListener('click', noFollow, true);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(archived = false) {
  await act(async () =>
    root.render(<ShareMenu term={FA} plans={PLANS} activeId="plan-1" archived={archived} flush={flush} onFlash={flash} />),
  );
}
// The dialog is portaled to <body>.
const dialog = () => document.body.querySelector('[role="dialog"]');
const text = () => dialog()?.textContent ?? '';
const rows = () => [...document.body.querySelectorAll('.planpick__item')];
const row = (t: string) => rows().find((e) => e.textContent?.includes(t));
const button = (t: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
async function press(el: Element | undefined | null) {
  if (!el) throw new Error(`no such element in: ${document.body.textContent}`);
  await act(async () => {
    (el as HTMLElement).click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const share = () => press(button('Share'));
const callsTo = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);
const putBody = () => JSON.parse(callsTo('PUT', '/api/calendar').at(-1)![1].body as string);

describe('ShareMenu', () => {
  it('opens a dialog that asks which plan of the term first, the one on screen marked', async () => {
    await render();
    expect(dialog()).toBeNull();
    await share();
    expect(text()).toContain('Which plan?');
    expect(text()).toContain('Your calendar shows one plan for Fall 2026.');
    expect(rows().map((e) => e.textContent)).toEqual(['Mine1 course · on screen', 'Backup0 courses']);
  });

  it('a first export makes the calendar link, then offers Apple and Google; choosing one saves the pick beside the others', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await render();
    await share();
    await press(row('Backup'));
    expect(flush).toHaveBeenCalled();
    expect(callsTo('POST', '/api/calendar/link')).toHaveLength(1);
    expect(text()).toContain('Which calendar?');
    expect(text()).toContain('“Backup” · Fall 2026');
    const apple = row('Export to Apple Calendar') as HTMLAnchorElement;
    const google = row('Export to Google Calendar') as HTMLAnchorElement;
    expect(apple.getAttribute('href')).toBe(WEBCAL);
    expect(google.getAttribute('href')).toBe(googleCalendarUrl(WEBCAL));
    expect(google.getAttribute('href')).toBe(
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Ftritonplan.cn%2Fapi%2Fcal%2Fsecret.ics',
    );
    expect(google.getAttribute('target')).toBe('_blank');
    expect(text()).not.toContain('Already in your calendar?');
    expect(callsTo('PUT', '/api/calendar')).toHaveLength(0); // nothing changes until they choose an app

    await press(apple);
    expect(putBody()).toEqual({ terms: { '2027|0': 'winter-plan', '2026|2': 'plan-2' } });
    expect(flash).toHaveBeenCalledWith('Your calendar shows “Backup” for Fall 2026.');
    expect(dialog()).not.toBeNull(); // still there while the browser follows the link
    await act(async () => vi.runAllTimers());
    expect(dialog()).toBeNull();
  });

  it('an account with a calendar link already: no new link, and it can just switch the term to this plan', async () => {
    calendar = () => json(200, { https: HTTPS, webcal: WEBCAL, terms: { '2026|2': 'plan-1' }, missing: [] });
    await render();
    await share();
    await press(row('Backup'));
    expect(callsTo('POST', '/api/calendar/link')).toHaveLength(0);
    expect(text()).toContain('Already in your calendar?');
    await press(button('Just switch it to this plan'));
    expect(putBody()).toEqual({ terms: { '2026|2': 'plan-2' } });
    expect(flash).toHaveBeenCalledWith('Your calendar shows “Backup” for Fall 2026.');
  });

  it('Back returns to the plans; ×, Escape and the backdrop close it', async () => {
    await render();
    await share();
    await press(row('Mine'));
    await press(button('Back to plans'));
    expect(text()).toContain('Which plan?');
    await press(dialog()!.querySelector('button[aria-label="Close"]'));
    expect(dialog()).toBeNull();
    await share();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog()).toBeNull();
    await share();
    await press(document.body.querySelector('.mappop__backdrop'));
    expect(dialog()).toBeNull();
  });

  it('calendar settings out of reach: says so and stays on the plans', async () => {
    calendar = () => json(500, { error: 'server' });
    await render();
    await share();
    await press(row('Mine'));
    expect(flash).toHaveBeenCalledWith("Couldn't reach your calendar settings. Check your connection and try again.");
    expect(text()).toContain('Which plan?');
  });

  it('a term that is over offers nothing to export', async () => {
    await render(true);
    await share();
    expect(rows()).toHaveLength(0);
    expect(text()).toContain('Fall 2026 is over');
  });
});

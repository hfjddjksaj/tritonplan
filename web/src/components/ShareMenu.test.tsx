import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Term } from '@triton/shared';
import { googleCalendarUrl, ShareMenu } from './ShareMenu';

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
  container = document.createElement('div');
  document.body.appendChild(container);
  // jsdom cannot follow webcal:// or a new tab; the handlers under test still run.
  container.addEventListener('click', (e) => e.preventDefault());
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(archived = false) {
  await act(async () =>
    root.render(<ShareMenu term={FA} plans={PLANS} activeId="plan-1" archived={archived} flush={flush} onFlash={flash} />),
  );
}
const items = () => [...container.querySelectorAll('[role="menuitem"]')];
const item = (t: string) => items().find((e) => e.textContent?.includes(t)) as HTMLElement | undefined;
async function press(el: Element | undefined | null) {
  if (!el) throw new Error(`no such element in: ${container.textContent}`);
  await act(async () => {
    (el as HTMLElement).click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const share = () => press([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Share')));
const callsTo = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);
const putBody = () => JSON.parse(callsTo('PUT', '/api/calendar').at(-1)![1].body as string);

describe('ShareMenu', () => {
  it('asks which plan of the term first, the one on screen marked', async () => {
    await render();
    await share();
    expect(container.textContent).toContain('Fall 2026 · which plan?');
    expect(items().map((e) => e.textContent)).toEqual(['Mine1 course · on screen', 'Backup0 courses']);
  });

  it('a first export makes the calendar link, then offers Apple and Google; choosing one saves the pick beside the others', async () => {
    await render();
    await share();
    await press(item('Backup'));
    expect(flush).toHaveBeenCalled();
    expect(callsTo('POST', '/api/calendar/link')).toHaveLength(1);
    expect(container.textContent).toContain('Backup · which calendar?');
    const apple = item('Export to Apple Calendar') as HTMLAnchorElement;
    const google = item('Export to Google Calendar') as HTMLAnchorElement;
    expect(apple.getAttribute('href')).toBe(WEBCAL);
    expect(google.getAttribute('href')).toBe(googleCalendarUrl(WEBCAL));
    expect(google.getAttribute('href')).toBe(
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Ftritonplan.cn%2Fapi%2Fcal%2Fsecret.ics',
    );
    expect(google.getAttribute('target')).toBe('_blank');
    expect(container.textContent).not.toContain('Already in your calendar?');
    expect(callsTo('PUT', '/api/calendar')).toHaveLength(0); // nothing changes until they choose an app

    await press(apple);
    expect(putBody()).toEqual({ terms: { '2027|0': 'winter-plan', '2026|2': 'plan-2' } });
    expect(flash).toHaveBeenCalledWith('Your calendar shows “Backup” for Fall 2026.');
  });

  it('an account with a calendar link already: no new link, and it can just switch the term to this plan', async () => {
    calendar = () => json(200, { https: HTTPS, webcal: WEBCAL, terms: { '2026|2': 'plan-1' }, missing: [] });
    await render();
    await share();
    await press(item('Backup'));
    expect(callsTo('POST', '/api/calendar/link')).toHaveLength(0);
    expect(container.textContent).toContain('Already in your calendar?');
    await press([...container.querySelectorAll('button')].find((b) => b.textContent === 'Just switch it to this plan'));
    expect(putBody()).toEqual({ terms: { '2026|2': 'plan-2' } });
    expect(flash).toHaveBeenCalledWith('Your calendar shows “Backup” for Fall 2026.');
  });

  it('back returns to the plans', async () => {
    await render();
    await share();
    await press(item('Mine'));
    await press(container.querySelector('button[aria-label="Back to plans"]'));
    expect(container.textContent).toContain('which plan?');
  });

  it('calendar settings out of reach: says so and stays on the plans', async () => {
    calendar = () => json(500, { error: 'server' });
    await render();
    await share();
    await press(item('Mine'));
    expect(flash).toHaveBeenCalledWith("Couldn't reach your calendar settings. Check your connection and try again.");
    expect(container.textContent).toContain('which plan?');
  });

  it('a term that is over offers nothing to export', async () => {
    await render(true);
    await share();
    expect(items()).toHaveLength(0);
    expect(container.textContent).toContain('Fall 2026 is over, so it is no longer in calendars.');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CourseOffering, RmpLookup } from '@triton/shared';
import { makeCourse } from '../lib/fixtures';
import { clearRmpCache } from '../lib/cloud/api';
import { RmpButton } from './RmpButton';
import { TooltipLayer, TIP_DELAY } from './Tooltip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const search = (n: string) => `https://www.ratemyprofessors.com/search/professors/1079?q=${encodeURIComponent(n)}`;
const matched = (name: string, avg: number | null, n: number): RmpLookup => ({
  name,
  match: { legacyId: 1, firstName: 'F', lastName: 'L', department: null, avgRating: avg, numRatings: n, url: `https://www.ratemyprofessors.com/professor/${name.length}` },
  searchUrl: search(name),
});
const unmatched = (name: string): RmpLookup => ({ name, match: null, searchUrl: search(name) });

function courseWith(...teachers: Array<[string, string]>): CourseOffering {
  const c = makeCourse('CSE-8A|2026|2', 'CSE-8A');
  c.options = [...new Set(teachers.map((t) => t[1]))].map((code, i) => ({
    id: `o${i}`, code, enrollCode: `o${i}`,
    components: teachers.filter((t) => t[1] === code).map((t, j) => ({
      id: `c${i}${j}`, type: 'LE', typeText: 'Lecture', sectionCode: 'x', instructors: [t[0]],
      meetings: [], unscheduled: true, rawSched: '',
    })),
  })) as CourseOffering['options'];
  return c;
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let openSpy: MockInstance<typeof window.open>;
let fakeTab: { opener: unknown; location: { href: string } };
const flash = vi.fn();
const order: string[] = [];

beforeEach(() => {
  clearRmpCache();
  flash.mockClear();
  order.length = 0;
  fakeTab = { opener: 'the-planner', location: { href: 'about:blank' } };
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
    order.push('open');
    return fakeTab as unknown as Window;
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  openSpy.mockRestore();
});

const reply = (results: RmpLookup[]) => new Response(JSON.stringify({ results }), { status: 200 });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

async function mount(course: CourseOffering) {
  await act(async () => {
    root.render(<><RmpButton course={course} onFlash={flash} /><TooltipLayer /></>);
    await settle();
  });
}
const button = () => container.querySelector('button')!;
async function click(el: HTMLElement) {
  await act(async () => { el.click(); await settle(); });
}
const dialog = () => document.body.querySelector('[role="dialog"]');

describe('RmpButton with no instructor', () => {
  it('is greyed out and its tooltip is still reachable by hover', async () => {
    vi.useFakeTimers();
    await mount(courseWith());
    expect(button().textContent).toContain('rate my professor');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    await click(button());
    expect(openSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // React derives onPointerEnter from pointerover; jsdom has no PointerEvent, so carry the one field it reads.
    const over = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(over, 'pointerType', { value: 'mouse' });
    await act(async () => {
      button().dispatchEvent(over);
      vi.advanceTimersByTime(TIP_DELAY + 10);
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "TSS doesn't list an instructor for this course yet.",
    );
  });
});

describe('RmpButton with one instructor', () => {
  it('opens the new tab in the click, before the lookup is even sent', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => {
      order.push('fetch');
      return new Promise<Response>((res) => { finish = res; });
    });
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    // Click outside act's microtask drain: only the handler's synchronous part has run, and the
    // fetch mock has not resolved. The tab must already be open, and open must precede the request.
    button().click();
    expect(order).toEqual(['open', 'fetch']);
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(fakeTab.opener).toBeNull();
    expect(fakeTab.location.href).toBe('about:blank');
    expect(fakeTab.location.href).toBe('about:blank'); // lookup still pending
    await act(async () => { finish(reply([matched('Joshua Figueroa', 4.2, 10)])); await settle(); });
    expect(fakeTab.location.href).toBe(matched('Joshua Figueroa', 4.2, 10).match!.url);
  });

  it('sends the name as TSS gave it, as a name parameter', async () => {
    fetchMock.mockResolvedValue(reply([unmatched('Joshua Figueroa')]));
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    await click(button());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/rmp?name=Joshua+Figueroa');
    expect((init as RequestInit).credentials).toBe('same-origin');
  });

  it('goes to the search page when there is no safe match', async () => {
    fetchMock.mockResolvedValue(reply([unmatched('Joshua Figueroa')]));
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    await click(button());
    expect(fakeTab.location.href).toBe(search('Joshua Figueroa'));
  });

  it('goes to the search page when the lookup fails', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    await click(button());
    expect(fakeTab.location.href).toBe(search('Joshua Figueroa'));
  });

  it('goes to the search page when the network is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    await click(button());
    expect(fakeTab.location.href).toBe(search('Joshua Figueroa'));
  });

  it('flashes when the browser blocked the tab, and does not look anything up', async () => {
    openSpy.mockImplementation(() => null);
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    await click(button());
    expect(flash).toHaveBeenCalledWith('Your browser blocked the new tab. Allow pop-ups for TritonPlan to open Rate My Professors.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('remembers a name for the page session but never a failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await mount(courseWith(['Joshua Figueroa', 'P-001']));
    await click(button());
    fetchMock.mockResolvedValueOnce(reply([matched('Joshua Figueroa', 4, 3)]));
    await click(button());
    expect(fetchMock).toHaveBeenCalledTimes(2); // the failure was retried
    await click(button());
    expect(fetchMock).toHaveBeenCalledTimes(2); // the success was not
    expect(fakeTab.location.href).toBe(matched('Joshua Figueroa', 4, 3).match!.url);
  });
});

describe('RmpButton with several instructors', () => {
  const two = () => courseWith(['Ada Lovelace', 'P-001'], ['Leo Porter', 'P-002'], ['Ada Lovelace', 'P-002']);

  it('opens a modal with a loading line, then a row per teacher', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((res) => { finish = res; }));
    await mount(two());
    await click(button());
    expect(openSpy).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain('Rate My Professors — CSE-8A');
    expect(dialog()!.textContent).toContain('Loading ratings…');
    await act(async () => {
      finish(reply([matched('Ada Lovelace', 4.25, 12), unmatched('Leo Porter')]));
      await settle();
    });
    const text = dialog()!.textContent!;
    expect(text).not.toContain('Loading ratings…');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('★ 4.3');
    expect(text).toContain('12 ratings');
    expect(text).toContain('Sections P-001, P-002');
    expect(text).toContain('Leo Porter');
    expect(text).toContain('no ratings');
    expect(text).toContain('Sections P-002');
    expect(text).toContain('Ratings from RateMyProfessors.com, updated monthly.');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/rmp?name=Ada+Lovelace&name=Leo+Porter');
  });

  it('says no ratings for a match with zero ratings', async () => {
    fetchMock.mockResolvedValue(reply([matched('Ada Lovelace', null, 0), unmatched('Leo Porter')]));
    await mount(two());
    await click(button());
    expect(dialog()!.textContent).not.toContain('★');
    expect(dialog()!.textContent!.match(/no ratings/g)).toHaveLength(2);
  });

  it('opens the professor page for a matched row, without an opener', async () => {
    fetchMock.mockResolvedValue(reply([matched('Ada Lovelace', 4, 3), unmatched('Leo Porter')]));
    await mount(two());
    await click(button());
    const rows = [...dialog()!.querySelectorAll('button')].filter((b) => b.textContent!.includes('Ada Lovelace'));
    await click(rows[0]!);
    expect(openSpy).toHaveBeenCalledWith(matched('Ada Lovelace', 4, 3).match!.url, '_blank', 'noopener');
  });

  it('opens the search page for a row with no match', async () => {
    fetchMock.mockResolvedValue(reply([matched('Ada Lovelace', 4, 3), unmatched('Leo Porter')]));
    await mount(two());
    await click(button());
    const row = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent!.includes('Leo Porter'))!;
    await click(row);
    expect(openSpy).toHaveBeenCalledWith(search('Leo Porter'), '_blank', 'noopener');
  });

  it('still lists everyone, linked to search, when the lookup fails', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await mount(two());
    await click(button());
    expect(dialog()!.textContent).not.toContain('Loading ratings…');
    const row = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent!.includes('Ada Lovelace'))!;
    await click(row);
    expect(openSpy).toHaveBeenCalledWith(search('Ada Lovelace'), '_blank', 'noopener');
  });

  it('closes on Escape and on the backdrop', async () => {
    fetchMock.mockResolvedValue(reply([unmatched('Ada Lovelace'), unmatched('Leo Porter')]));
    await mount(two());
    await click(button());
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(dialog()).toBeNull();
    await click(button());
    await click(document.body.querySelector('.mappop__backdrop') as HTMLElement);
    expect(dialog()).toBeNull();
  });
});

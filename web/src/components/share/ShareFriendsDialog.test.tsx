import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import { ShareFriendsDialog, type SharablePlan } from './ShareFriendsDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const DAY = 86_400_000;

const plan = (n: number): PlanState =>
  ({ version: 1, entries: Array.from({ length: n }, (_, i) => ({ course: { id: `c${i}` }, options: [] })) }) as unknown as PlanState;
const A: SharablePlan = { id: 'a', name: 'Plan A', plan: plan(2) };
const B: SharablePlan = { id: 'b', name: 'Plan B', plan: plan(1) };
const EMPTY: SharablePlan = { id: 'e', name: 'Empty', plan: plan(0) };

const link = (code: string, name: string, createdAt: number) => ({
  code, url: `https://tritonplan.test/s/${code}`, name, termKey: '2026|2',
  createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + 7 * DAY).toISOString(),
});

let container: HTMLDivElement;
let root: Root;
let listed: ReturnType<typeof link>[];
let createAnswer: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;
const onCopied = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  onCopied.mockClear();
  listed = [];
  createAnswer = () => json(200, { code: 'new1', url: 'https://tritonplan.test/s/new1', expiresAt: new Date(Date.now() + 7 * DAY).toISOString() });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/shared') return createAnswer();
    if (url === '/api/shared') return json(200, { shared: listed });
    return json(500, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  write = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(plans: SharablePlan[]) {
  await act(async () => root.render(<ShareFriendsDialog plans={plans} onClose={onClose} onCopied={onCopied} />));
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}
const btn = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error('missing button');
  await act(async () => {
    (el as HTMLElement).click();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
const text = () => document.body.textContent ?? '';

describe('ShareFriendsDialog', () => {
  it('says so when nothing is shared, with the helper line', async () => {
    await render([A]);
    expect(text()).toContain('Nothing shared right now.');
    expect(text()).toContain("Anyone with a link can switch sections for 7 days. Your own plan doesn't change.");
  });

  it('lists live links with term label and days left', async () => {
    listed = [link('abc', 'Plan A', Date.now() - DAY)];
    await render([A]);
    expect(text()).toContain('Plan A');
    expect(text()).toContain('Fall 2026 · expires in 6 days');
  });

  it('says "expires today" inside the last 24 hours', async () => {
    listed = [link('abc', 'Plan A', Date.now() - 6.5 * DAY)];
    await render([A]);
    expect(text()).toContain('Fall 2026 · expires today');
  });

  it('copies a link when its row is clicked', async () => {
    listed = [link('abc', 'Plan A', Date.now())];
    await render([A]);
    await click(document.body.querySelector('.sharelist__main')!);
    expect(write).toHaveBeenCalledWith('https://tritonplan.test/s/abc');
    expect(onCopied).toHaveBeenCalledWith('Link copied');
  });

  it('shows a QR code for a row', async () => {
    listed = [link('abc', 'Plan A', Date.now())];
    await render([A]);
    expect(document.body.querySelector('.sharelist__qr svg')).toBeNull();
    await click(btn('QR code for Plan A'));
    expect(document.body.querySelector('.sharelist__qr svg')).not.toBeNull();
  });

  it('New share with a single plan creates at once, lists it first and copies it', async () => {
    listed = [link('old', 'Old', Date.now() - DAY)];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        listed = [link('old', 'Old', Date.now() - DAY), link('new1', 'Plan A', Date.now())];
        return createAnswer();
      }
      return json(200, { shared: listed });
    });
    await render([A, EMPTY]);
    await click(btn('New share'));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const sent = JSON.parse((post[1] as RequestInit).body as string);
    expect(sent.name).toBe('Plan A');
    expect(sent.plan.entries[0].course.id).toBe('c0');
    const names = [...document.body.querySelectorAll('.sharelist__name')].map((n) => n.textContent);
    expect(names).toEqual(['Plan A', 'Old']);
    expect(write).toHaveBeenCalledWith('https://tritonplan.test/s/new1');
    expect(onCopied).toHaveBeenCalledWith('Link copied');
  });

  it('asks which plan when there are several, and never offers an empty one', async () => {
    await render([A, B, EMPTY]);
    await click(btn('New share'));
    expect(btn('Plan A')).toBeDefined();
    expect(btn('Plan B')).toBeDefined();
    expect(btn('Empty')).toBeUndefined();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
    await click(btn('Plan B'));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string).name).toBe('Plan B');
  });

  it('disables New share when every plan is empty', async () => {
    await render([EMPTY]);
    expect((btn('New share') as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains too_many_shares', async () => {
    createAnswer = () => json(409, { error: 'too_many_shares' });
    await render([A]);
    await click(btn('New share'));
    expect(text()).toContain('You have too many live links. Wait for one to expire.');
    expect(onCopied).not.toHaveBeenCalled();
  });
});

// WebKit (every iPhone browser) lets a page write the clipboard only inside the click itself.
describe('ShareFriendsDialog where ClipboardItem exists', () => {
  class FakeClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  let blobs: Blob[];
  let cbWrite: ReturnType<typeof vi.fn>;
  const blobText = (b: Blob) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(r.error);
      r.readAsText(b);
    });

  beforeEach(() => {
    blobs = [];
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    cbWrite = vi.fn(async (items: FakeClipboardItem[]) => {
      blobs.push(await items[0]!.data['text/plain']!);
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: cbWrite, writeText: write } });
  });

  it('starts the clipboard write inside the click, before the link exists', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>((res) => { finish = res; });
      return json(200, { shared: listed });
    });
    await render([A]);
    btn('New share')!.click(); // outside act's drain: only the synchronous part has run
    expect(cbWrite).toHaveBeenCalledTimes(1);
    expect(onCopied).not.toHaveBeenCalled();
    await act(async () => {
      finish(createAnswer());
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(await blobText(blobs[0]!)).toBe('https://tritonplan.test/s/new1');
    expect(write).not.toHaveBeenCalled();
    expect(onCopied).toHaveBeenCalledWith('Link copied');
  });

  it('the plan choice copies in its click too', async () => {
    await render([A, B]);
    await click(btn('New share'));
    expect(cbWrite).not.toHaveBeenCalled();
    await click(btn('Plan B'));
    expect(cbWrite).toHaveBeenCalledTimes(1);
    expect(onCopied).toHaveBeenCalledWith('Link copied');
  });

  it('a failed create writes nothing', async () => {
    createAnswer = () => json(409, { error: 'too_many_shares' });
    await render([A]);
    await click(btn('New share'));
    expect(cbWrite).toHaveBeenCalledTimes(1);
    expect(blobs).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
    expect(text()).toContain('You have too many live links.');
  });
});

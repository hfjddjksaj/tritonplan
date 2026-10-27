import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { makePlan } from '../lib/fixtures';
import { ShareMenu } from './ShareMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const LINK = 'https://tritonplan.cn/s/abc123';

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let answer: () => Response;
let writeText: ReturnType<typeof vi.fn>;
const flash = vi.fn();

beforeEach(() => {
  flash.mockClear();
  answer = () => json(200, { code: 'abc123', url: LINK });
  fetchMock = vi.fn(async () => answer());
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

const plan = makePlan();
async function render() {
  await act(async () => root.render(<ShareMenu plan={plan} planName="Fall draft" onFlash={flash} />));
}
const label = (t: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
async function click(t: string) {
  const el = label(t);
  if (!el) throw new Error(`no button ${t}`);
  await act(async () => {
    el.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const posts = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/shares');

describe('ShareMenu', () => {
  it('has no Full / Lite toggle', async () => {
    await render();
    await click('Share');
    expect(label('Full')).toBeUndefined();
    expect(label('Lite')).toBeUndefined();
  });

  it('Copy link posts the plan under its name and copies the /s/ link', async () => {
    await render();
    await click('Share');
    await click('Copy link');
    expect(posts()).toHaveLength(1);
    const sent = JSON.parse((posts()[0]![1] as RequestInit).body as string);
    expect(sent.name).toBe('Fall draft');
    expect(Object.keys(sent.plan).sort()).toEqual(['entries', 'term', 'version']);
    expect(JSON.stringify(sent.plan)).not.toMatch(/booked|appt|waitlist/i);
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(flash).toHaveBeenCalledWith('Link copied — anyone with it can view this plan.');
  });

  it.each([
    ['150 characters', 'x'.repeat(150)],
    ['an emoji straddling the 100th code unit', 'x'.repeat(99) + '😀' + 'tail'],
  ])('a long plan name (%s) is cut to 100 code units and still shares', async (_label, longName) => {
    await act(async () => root.render(<ShareMenu plan={plan} planName={longName} onFlash={flash} />));
    await click('Share');
    await click('Copy link');
    const sent = JSON.parse((posts()[0]![1] as RequestInit).body as string);
    expect(sent.name.length).toBeGreaterThan(0);
    expect(sent.name.length).toBeLessThanOrEqual(100);
    expect(sent.name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(flash).toHaveBeenCalledWith('Link copied — anyone with it can view this plan.');
  });

  it('a failed create flashes the line and writes nothing to the clipboard', async () => {
    answer = () => json(500, { error: 'server' });
    await render();
    await click('Share');
    await click('Copy link');
    expect(flash).toHaveBeenCalledWith("Couldn't create a link. Check your connection and try again.");
    expect(writeText).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('QR code shows the short link', async () => {
    await render();
    await click('Share');
    await click('QR code');
    expect(posts()).toHaveLength(1);
    expect(document.body.querySelector('.qrpop__code svg')).not.toBeNull();
  });

  it('a failed create for the QR flashes and shows no code', async () => {
    answer = () => json(409, { error: 'too_many_shares' });
    await render();
    await click('Share');
    await click('QR code');
    expect(flash).toHaveBeenCalledWith("Couldn't create a link. Check your connection and try again.");
    expect(document.body.querySelector('.qrpop')).toBeNull();
  });

  it('a double click makes one link', async () => {
    await render();
    await click('Share');
    const copy = label('Copy link')!;
    await act(async () => {
      copy.click();
      copy.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(posts()).toHaveLength(1);
  });
});

// WebKit (every iPhone browser) lets a page write the clipboard only inside the click itself.
describe('ShareMenu where ClipboardItem exists', () => {
  class FakeClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  const order: string[] = [];
  let blobs: Blob[];
  let write: ReturnType<typeof vi.fn>;
  const blobText = (b: Blob) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(r.error);
      r.readAsText(b);
    });

  beforeEach(() => {
    order.length = 0;
    blobs = [];
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    // Like the real one: the write settles once the item's data does, and fails if that data fails.
    write = vi.fn(async (items: FakeClipboardItem[]) => {
      order.push('write');
      blobs.push(await items[0]!.data['text/plain']!);
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
  });

  it('starts the clipboard write inside the click, before the link exists, and copies the short link', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => {
      order.push('fetch');
      return new Promise<Response>((res) => { finish = res; });
    });
    await render();
    await click('Share');
    // Outside act's microtask drain: only the handler's synchronous part has run and the share is still pending.
    label('Copy link')!.click();
    expect(order).toEqual(['fetch', 'write']);
    expect(flash).not.toHaveBeenCalled();
    await act(async () => {
      finish(json(200, { code: 'abc123', url: LINK }));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe('text/plain');
    expect(await blobText(blobs[0]!)).toBe(LINK);
    expect(writeText).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith('Link copied — anyone with it can view this plan.');
    expect(label('Copy link')).toBeUndefined(); // the menu closed
  });

  it('a failed create writes nothing and flashes the create failure', async () => {
    answer = () => json(500, { error: 'server' });
    await render();
    await click('Share');
    await click('Copy link');
    expect(write).toHaveBeenCalledTimes(1);
    expect(blobs).toEqual([]);
    expect(writeText).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledTimes(1);
    expect(flash).toHaveBeenCalledWith("Couldn't create a link. Check your connection and try again.");
  });

  it('a refused clipboard write shows the link instead', async () => {
    write.mockImplementation(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    await render();
    await click('Share');
    await click('Copy link');
    expect(flash).toHaveBeenCalledWith(`Couldn't copy automatically — your link is ${LINK}`);
  });

  it('a ClipboardItem that refuses a promise falls back to copying the text', async () => {
    vi.stubGlobal('ClipboardItem', class {
      constructor() { throw new TypeError('promises not supported'); }
    });
    answer = () => json(500, { error: 'server' });
    await render();
    await click('Share');
    await click('Copy link');
    expect(flash).toHaveBeenLastCalledWith("Couldn't create a link. Check your connection and try again.");
    answer = () => json(200, { code: 'abc123', url: LINK });
    await click('Copy link');
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(flash).toHaveBeenLastCalledWith('Link copied — anyone with it can view this plan.');
  });

  it('without ClipboardItem it copies the text after the link exists', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    await render();
    await click('Share');
    await click('Copy link');
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(flash).toHaveBeenCalledWith('Link copied — anyone with it can view this plan.');
  });
});

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

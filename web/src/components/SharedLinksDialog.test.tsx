import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SharedLinksDialog } from './SharedLinksDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const shares = [
  { code: 'aaa', name: 'Fall draft', url: 'https://tritonplan.cn/s/aaa', createdAt: '2026-10-03T12:00:00Z' },
  { code: 'bbb', name: 'Backup', url: 'https://tritonplan.cn/s/bbb', createdAt: '2026-09-21T12:00:00Z' },
];

let container: HTMLDivElement;
let root: Root;
let answers: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;
const flash = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  flash.mockClear();
  onClose.mockClear();
  answers = { 'GET /api/shares': () => json(200, { shares }) };
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

async function render() {
  await act(async () => {
    root.render(<SharedLinksDialog onClose={onClose} onFlash={flash} />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const btns = (t: string) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === t);
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const text = () => document.body.querySelector('[role="dialog"]')!.textContent!;
const deletes = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE');
const confirmTurnOff = () => btns('Turn off').find((b) => b.classList.contains('acctdlg__danger'))!;

describe('SharedLinksDialog', () => {
  it('lists each link with its name and date', async () => {
    await render();
    expect(text()).toContain('Shared links');
    expect(text()).toContain('Fall draft');
    expect(text()).toContain('Shared Oct 3');
    expect(text()).toContain('Shared Sep 21');
    expect(btns('Copy')).toHaveLength(2);
    expect(btns('Turn off')).toHaveLength(2);
  });

  it('says so when nothing has been shared', async () => {
    answers['GET /api/shares'] = () => json(200, { shares: [] });
    await render();
    expect(text()).toContain("You haven't shared any plans yet.");
  });

  it('a failed list says it could not load', async () => {
    answers['GET /api/shares'] = () => json(500, {});
    await render();
    expect(text()).toContain("Couldn't load your shared links.");
  });

  it('Copy puts the link on the clipboard', async () => {
    await render();
    await click(btns('Copy')[1]!);
    expect(writeText).toHaveBeenCalledWith('https://tritonplan.cn/s/bbb');
    expect(flash).toHaveBeenCalledWith('Link copied.');
  });

  it('Turn off asks first, and Keep sends nothing', async () => {
    await render();
    await click(btns('Turn off')[0]!);
    expect(text()).toContain('Turn off this link? Anyone who opens it will see that it no longer works.');
    expect(deletes()).toHaveLength(0);
    await click(btns('Keep')[0]!);
    expect(deletes()).toHaveLength(0);
    expect(text()).toContain('Fall draft');
  });

  it('confirming sends DELETE and removes the row', async () => {
    answers['DELETE /api/shares/aaa'] = () => json(200, { ok: true });
    await render();
    await click(btns('Turn off')[0]!);
    await click(confirmTurnOff());
    expect(deletes().map((c) => c[0])).toEqual(['/api/shares/aaa']);
    expect(text()).not.toContain('Fall draft');
    expect(text()).toContain('Backup');
  });

  it('a link already gone (404) leaves the list too', async () => {
    answers['DELETE /api/shares/aaa'] = () => json(404, { error: 'not_found' });
    await render();
    await click(btns('Turn off')[0]!);
    await click(confirmTurnOff());
    expect(text()).not.toContain('Fall draft');
  });

  it('a failed turn-off keeps the row and flashes', async () => {
    await render();
    await click(btns('Turn off')[0]!);
    await click(confirmTurnOff());
    expect(text()).toContain('Fall draft');
    expect(flash).toHaveBeenCalledWith("Couldn't turn that link off. Please try again.");
  });
});

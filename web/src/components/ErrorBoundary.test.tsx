import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import { nav } from '../lib/nav';
import { resetBridgeHubForTests } from '../lib/bridge';
import { makePlan } from '../lib/fixtures';
import { loadViewing, saveReceived, saveViewing } from '../lib/storage';
import { snapshotOf, TEST_ME } from '../test/boot';
import { ErrorBoundary } from './ErrorBoundary';
import Root from '../Root';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stands in for the planner failing to render, e.g. a code-split chunk that a deploy removed.
const { appThrows } = vi.hoisted(() => ({ appThrows: { on: false } }));
vi.mock('../App', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../App')>();
  return {
    default: (props: Parameters<typeof mod.default>[0]) => {
      if (appThrows.on) throw new Error('Failed to fetch dynamically imported module');
      return mod.default(props);
    },
  };
});

let container: HTMLDivElement;
let root: ReactRoot;
let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  appThrows.on = false;
  localStorage.clear();
  sessionStorage.clear();
  resetBridgeHubForTests();
  reload = vi.spyOn(nav, 'reload').mockImplementation(() => {});
  // React reports every caught render error on the console; the test does not need the noise.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = () => container.textContent ?? '';
async function clickReload() {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reload');
  if (!btn) throw new Error(`no Reload button in: ${text()}`);
  await act(async () => btn.click());
}

function Boom(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('renders its children while they work', async () => {
    await act(async () => root.render(<ErrorBoundary><p>fine</p></ErrorBoundary>));
    expect(text()).toBe('fine');
  });

  it('a render error shows the reload screen, and Reload reloads the page', async () => {
    await act(async () => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));
    expect(text()).toContain('Something went wrong. Reload to continue.');
    await clickReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('wraps the planner in Root: a planner that cannot render offers Reload instead of a blank page', async () => {
    appThrows.on = true;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url === '/api/me' ? TEST_ME : snapshotOf())));
    window.history.replaceState(null, '', '/');
    await act(async () => root.render(<Root />));
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(text()).toContain('Something went wrong. Reload to continue.');
    await clickReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the planner's Reload goes back to the student's own plans first, so a received plan that crashed it cannot crash it again", async () => {
    appThrows.on = true;
    saveReceived({ plan: makePlan(), source: 'link', receivedAt: '2026-10-26T00:00:00.000Z' });
    saveViewing('received');
    let viewingAtReload: string | null = null;
    reload.mockImplementation(() => { viewingAtReload = loadViewing(); });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url === '/api/me' ? TEST_ME : snapshotOf())));
    window.history.replaceState(null, '', '/');
    await act(async () => root.render(<Root />));
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(text()).toContain('Something went wrong. Reload to continue.');
    expect(loadViewing()).toBe('received');
    await clickReload();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(viewingAtReload).toBe('mine');
  });
});

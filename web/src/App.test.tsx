import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import App from './App';
import { makeTestBoot } from './test/boot';
import { makeGuestBoot } from './lib/cloud/boot';
import { clearRmpCache } from './lib/cloud/api';
import { makeCourse } from './lib/fixtures';
import type { TermsState } from './lib/terms-state';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('App → campus map', () => {
  let container: HTMLDivElement;
  let root: Root;
  let boot: ReturnType<typeof makeTestBoot>;
  beforeEach(() => {
    boot = makeTestBoot();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    boot.engine.dispose();
  });

  it('opens the map on the view the planner is showing', async () => {
    await act(async () => {
      root.render(<App boot={boot} />);
    });
    const finals = [...container.querySelectorAll('.toolbar [role="tab"]')].find((b) =>
      b.textContent?.includes('Finals'),
    ) as HTMLButtonElement;
    await act(async () => finals.click());
    const mapBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Map') as HTMLButtonElement;
    await act(async () => mapBtn.click());
    // CampusMap is code-split (React.lazy + Suspense), so the island arrives a few
    // ticks after the click rather than in the same flush — pump until it lands.
    for (let i = 0; i < 40 && !container.querySelector('.campusmap__island'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    const island = container.querySelector('.campusmap__island')!;
    expect(island).not.toBeNull();
    const selected = [...island.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'));
    expect(selected).toEqual(['false', 'false', 'true']);
  });

  it('installs the unload guard once per boot and removes it on unmount', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const count = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === 'beforeunload').length;
    await act(async () => {
      root.render(<App boot={boot} />);
    });
    expect(count(add)).toBe(1);
    act(() => root.unmount());
    expect(count(remove)).toBe(1);
    root = createRoot(container); // afterEach unmounts this one
    vi.restoreAllMocks();
  });
});

describe('App → extension update note', () => {
  const NOTE =
    'After the TritonPlan extension updates, Chrome may switch it off until you allow its new site. ' +
    'If the + TritonPlan button disappears from TSS, open chrome://extensions and turn TritonPlan back on.';
  const KEY = 'triton-planner:ext-update-note:v1';
  let container: HTMLDivElement;
  let root: Root;
  let boot: ReturnType<typeof makeTestBoot>;
  beforeEach(() => {
    boot = makeTestBoot();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    boot.engine.dispose();
  });
  async function mount() {
    root = createRoot(container);
    await act(async () => root.render(<App boot={boot} />));
  }

  it('shows once per browser until dismissed', async () => {
    await mount();
    expect(container.textContent).toContain(NOTE);
    const dismiss = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Dismiss')!;
    await act(async () => dismiss.click());
    expect(container.textContent).not.toContain(NOTE);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    act(() => root.unmount());
    await mount(); // the next sign-in on this browser
    expect(container.textContent).not.toContain(NOTE);
  });

  it('is not shown signed out: a new visitor never had the old extension', async () => {
    root = createRoot(container);
    await act(async () => root.render(<App boot={makeGuestBoot()} onSignIn={() => {}} />));
    expect(container.querySelector('.app')).not.toBeNull();
    expect(container.textContent).not.toContain(NOTE);
  });

  it('is still shown when the browser cannot remember the dismissal', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await mount();
      expect(container.textContent).toContain(NOTE);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('App → a teacher on the calendar', () => {
  let container: HTMLDivElement;
  let root: Root;
  let boot: ReturnType<typeof makeTestBoot>;

  /** One course, section P-002 chosen, its lecture on Mondays taught by Leo Porter. */
  function account(): TermsState {
    const course = makeCourse('CSE-8A|2026|2', 'CSE-8A');
    const lecture = (id: string, who: string) => ({
      id, type: 'LE', typeText: 'Lecture', sectionCode: 'A00', instructors: [who], unscheduled: false, rawSched: '',
      meetings: [{ days: ['Mon' as const], start: '11:00', end: '11:50', modality: 'In Person', building: 'Center Hall', room: '109' }],
    });
    course.options = [
      { id: 'o1', code: 'P-001', enrollCode: 'o1', components: [lecture('E1', 'Ada Lovelace')] },
      { id: 'o2', code: 'P-002', enrollCode: 'o2', components: [lecture('E2', 'Leo Porter')] },
    ];
    const plan: PlanState = { version: 1, term: course.term, entries: [{ course, selectedOptionId: 'o2' }] };
    return {
      version: 1,
      activeTermKey: '2026|2',
      terms: { '2026|2': { term: course.term, plans: { activeId: 'p', plans: [{ id: 'p', name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] }] } } },
    };
  }

  beforeEach(() => {
    localStorage.clear();
    clearRmpCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));
    boot = makeTestBoot({ terms: account() });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    boot.engine.dispose();
    vi.unstubAllGlobals();
  });

  it("opens the course's ratings dialog, the plan's section marked", async () => {
    await act(async () => root.render(<App boot={boot} />));
    const link = container.querySelector<HTMLButtonElement>('.cal-canvas button.block__instr--link')!;
    expect(link.textContent).toBe('Leo Porter');
    await act(async () => link.click());
    const dialog = document.body.querySelector('[role="dialog"][aria-label="Rate My Professors — CSE-8A"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Your section, P-002, is taught by Leo Porter.');
    expect([...dialog.querySelectorAll('.rmp__link')].map((n) => n.textContent)).toEqual(['Ada Lovelace', 'Leo Porter']);
    await act(async () => dialog.querySelector<HTMLButtonElement>('.mappop__close')!.click());
    expect(document.body.querySelector('.rmp')).toBeNull();
  });
});

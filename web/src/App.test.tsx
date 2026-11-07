import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlanState } from '@triton/shared';
import App from './App';
import { makeTestBoot } from './test/boot';
import { makeGuestBoot } from './lib/cloud/boot';
import { clearRmpCache } from './lib/cloud/api';
import { makeCourse, makePlan } from './lib/fixtures';
import type { TermsState } from './lib/terms-state';
import { fakeMapLibreModule } from './test/fake-maplibre';
vi.mock('maplibre-gl', () => fakeMapLibreModule);
import { menuOptions, menuPick, menuShown } from './test/menu-select';

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

describe("App → the map's term button", () => {
  let container: HTMLDivElement;
  let root: Root;
  let boot: ReturnType<typeof makeTestBoot>;

  /** Fall 2026 with a course, and Winter 2026 (the term after it) with one too. */
  function account(): TermsState {
    const fall = makePlan();
    const winterCourse = makeCourse('CSE-12|2026|3', 'CSE-12');
    const winter: PlanState = {
      version: 1,
      term: { year: '2026', period: '3', label: 'Winter 2026' },
      entries: [{ course: winterCourse, selectedOptionId: winterCourse.options[0]!.id }],
    };
    const ws = (plan: PlanState, id: string) => ({
      term: plan.term,
      plans: { activeId: id, plans: [{ id, name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] }] },
    });
    return { version: 1, activeTermKey: '2026|3', terms: { '2026|2': ws(fall, 'f'), '2026|3': ws(winter, 'w') } };
  }
  const termChip = () => container.querySelector('.topbar__term-label')?.textContent ?? '';

  beforeEach(() => {
    localStorage.clear();
    clearRmpCache();
    // Both terms are live: Fall 2026 archives on Dec 20, so the planner opens on the newest, Winter.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
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
    vi.useRealTimers();
  });

  it('opens on the planner’s term, offers the account’s others, and switching leaves the planner alone', async () => {
    await act(async () => root.render(<App boot={boot} />));
    expect(termChip()).toContain('Winter 2026');
    const mapBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Map')!;
    await act(async () => mapBtn.click());
    const termButton = () =>
      container.querySelector<HTMLButtonElement>('.campusmap__cluster button[aria-haspopup="listbox"]');
    for (let i = 0; i < 40 && !termButton(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    const b = termButton()!;
    expect(menuShown(b)).toBe('Winter 2026');
    expect(menuOptions(b).map((o) => o.label)).toEqual(['Fall 2026', 'Winter 2026']);
    menuPick(b, '2026|2');
    expect(menuShown(termButton()!)).toBe('Fall 2026');
    expect(termChip()).toContain('Winter 2026');
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
    // Fall 2026 is still open (it archives on Dec 20), so the planner opens on it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
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
    vi.useRealTimers();
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

describe("App → the next term's enrollment bar", () => {
  const OPEN = 'Winter 2026 enrollment is open';
  let container: HTMLDivElement;
  let root: Root;
  let boot: ReturnType<typeof makeTestBoot> | null;

  /** Fall 2026 with a planned course, and no Winter yet. */
  function fallAccount(): TermsState {
    const plan = makePlan();
    return {
      version: 1,
      activeTermKey: '2026|2',
      terms: { '2026|2': { term: plan.term, plans: { activeId: 'p', plans: [{ id: 'p', name: 'Plan', plan, createdAt: 'c', updatedAt: 'u', browsed: [] }] } } },
    };
  }
  const bar = () => [...container.querySelectorAll('.received--active')].find((n) => n.textContent?.includes(OPEN)) ?? null;
  const termChip = () => container.querySelector('.topbar__term-label')?.textContent ?? '';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearRmpCache();
    // Winter 2026 enrollment opened on Nov 5; Fall 2026 is not over until Dec 20.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));
    boot = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    boot?.engine.dispose();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows on a Fall-with-courses account; its button creates Winter, opens it and the bar goes', async () => {
    boot = makeTestBoot({ terms: fallAccount() });
    await act(async () => root.render(<App boot={boot!} />));
    expect(termChip()).toContain('Fall 2026');
    const shown = bar();
    expect(shown).not.toBeNull();
    const create = [...shown!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create Winter 2026')!;
    await act(async () => create.click());
    expect(bar()).toBeNull();
    expect(termChip()).toContain('Winter 2026');
  });

  it('is not shown signed out: the guest bar is', async () => {
    // Even with a Fall plan on screen and no Winter, which would show it to a signed-in student.
    await act(async () => root.render(<App boot={{ ...makeGuestBoot(), terms: fallAccount() }} onSignIn={() => {}} />));
    expect(termChip()).toContain('Fall 2026');
    expect(bar()).toBeNull();
    expect(container.textContent).toContain('You’re not signed in');
  });
});

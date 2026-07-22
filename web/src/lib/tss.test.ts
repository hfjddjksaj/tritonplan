import { describe, it, expect, vi } from 'vitest';
import type { SectionOption } from '@triton/shared';
import { tssDeepLink, tssBookingLink, openInTss } from './tss';
import { PAGE_BRIDGE_SOURCE } from './bridge';
import { makeCourse } from './fixtures';

describe('tssDeepLink', () => {
  it('builds a TSS Fiori module link from the course term + moduleId', () => {
    const course = makeCourse('CSE-8A|2026|2', 'CSE-8A');
    course.moduleId = '8461';
    course.term = { year: '2026', period: '2', label: 'Fall 2026' };

    const link = tssDeepLink(course);
    expect(link).toBe(
      "https://tss.ucsd.edu/fiori#YSchedule-view?sap-app-origin-hint=&/YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='8461')",
    );
    expect(link.startsWith('https://tss.ucsd.edu/fiori#')).toBe(true);
  });
});

describe('tssBookingLink', () => {
  function option(partial: Partial<SectionOption>): SectionOption {
    return { id: 'SM 1', code: 'P-001-001', enrollCode: 'SE00000001', components: [], ...partial };
  }

  it('reproduces a live "Go To Booking" URL from moduleId + package number', () => {
    // Captured live 2026-07-22: CHEM 100A, first section.
    const course = makeCourse('CHEM-100A|2026|2', 'CHEM-100A');
    course.moduleId = '2060';
    course.term = { year: '2026', period: '2', label: 'Fall 2026' };
    expect(tssBookingLink(course, option({ enrollCode: 'SE00152185' }))).toBe(
      'https://tss.ucsd.edu/fiori#ZUSModule-display?TileType=MYMOD&/Detail/EventPackage/SM/' +
        '2060/00000000/0/0/0/00000000-0000-0000-0000-000000000000/152185/2026/2/?',
    );
  });

  it('falls back to the option id, and returns null when neither parses', () => {
    const course = makeCourse('CHEM-100A|2026|2', 'CHEM-100A');
    course.moduleId = '2060';
    course.term = { year: '2026', period: '2', label: 'Fall 2026' };
    expect(
      tssBookingLink(course, option({ enrollCode: undefined as unknown as string, id: 'SM00152186' })),
    ).toContain('/152186/2026/2/?');
    expect(tssBookingLink(course, option({ enrollCode: 'P-001-001', id: 'weird' }))).toBeNull();
  });
});

describe('openInTss', () => {
  function course() {
    const c = makeCourse('CSE-8A|2026|2', 'CSE-8A');
    c.moduleId = '8461';
    c.term = { year: '2026', period: '2', label: 'Fall 2026' };
    return c;
  }

  it('posts an open-tss request for the extension bridge when routed through it', async () => {
    const seen: unknown[] = [];
    const onMsg = (e: MessageEvent) => seen.push(e.data);
    window.addEventListener('message', onMsg);
    openInTss(course(), true);
    await new Promise((r) => setTimeout(r, 0)); // postMessage delivers async
    window.removeEventListener('message', onMsg);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      source: PAGE_BRIDGE_SOURCE,
      type: 'open-tss',
      version: 1,
      payload: { url: tssDeepLink(course()), moduleId: '8461' },
    });
  });

  it('falls back to a plain new tab without the extension', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openInTss(course());
    expect(open).toHaveBeenCalledWith(tssDeepLink(course()), '_blank', 'noopener');
    open.mockRestore();
  });
});

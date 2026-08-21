import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CourseOffering, SectionOption } from '@triton/shared';
import { OptionPicker, waitlistOnlyTitle } from './OptionPicker';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function opt(code: string, seatsAvailable: number, status?: string): SectionOption {
  return {
    id: `SE-${code}`,
    code,
    enrollCode: `SE-${code}`,
    seatsAvailable,
    limit: 23,
    components: [],
    ...(status === undefined ? {} : { status }),
  };
}

/** CHEM-043A's real shape: an open package, a waitlist-gated one that still has
 *  seats, one that is simply out of seats, and one that is both. */
function course(): CourseOffering {
  return {
    id: 'CHEM-043A|2026|2',
    moduleId: '2117',
    subject: 'CHEM',
    number: '043A',
    courseCode: 'CHEM-043A',
    title: 'Organic Chemistry Laboratory',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    options: [
      opt('P-001-001', 12),
      opt('P-002-002', 5, 'Waitlist Only'),
      opt('P-002-004', 0),
      opt('P-003-001', 0, 'Waitlist Only'),
    ],
  };
}

describe('OptionPicker · waitlist-only sections', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(selectedOptionId: string, collapsed = false) {
    act(() => {
      root.render(
        <OptionPicker
          course={course()}
          selectedOptionId={selectedOptionId}
          onSelect={() => {}}
          collapsed={collapsed}
          onToggle={() => {}}
        />,
      );
    });
  }

  /** The option row whose code is `code`. */
  function row(code: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('.opt')].find(
      (el) => el.querySelector('.opt__code')?.textContent?.startsWith(code),
    );
    if (!found) throw new Error(`no option row for ${code}`);
    return found;
  }

  it('marks only the waitlist-gated packages, and says so in words', () => {
    render('SE-P-001-001');
    expect(row('P-002-002').querySelector('.opt__wl')?.textContent).toBe('Waitlist only');
    expect(row('P-003-001').querySelector('.opt__wl')?.textContent).toBe('Waitlist only');
    expect(row('P-001-001').querySelector('.opt__wl')).toBeNull();
    expect(row('P-002-004').querySelector('.opt__wl')).toBeNull();
  });

  it('the hover wording names the seats that are out of reach', () => {
    // Only worth explaining when the number beside it says the opposite: five
    // open seats read as "go enroll", zero seats explain themselves.
    expect(waitlistOnlyTitle(5)).toBe(
      "5 seats are open, but TSS will only let you join this section's waitlist.",
    );
    expect(waitlistOnlyTitle(0)).toBe("TSS will only let you join this section's waitlist.");
    expect(waitlistOnlyTitle(undefined)).toBe(
      "TSS will only let you join this section's waitlist.",
    );
  });

  it('leaves the seat column alone — the count and its label are untouched', () => {
    // The mark lives beside the code; the right-hand column stays one thing, so
    // the eye can still run down a single column of seat numbers.
    render('SE-P-001-001');
    const wl = row('P-002-002');
    expect(wl.querySelector('.opt__seats-n')?.textContent).toBe('5/23');
    expect(wl.querySelector('.opt__seats-label')?.textContent).toBe('seats');
    expect(row('P-001-001').querySelector('.opt__seats-label')?.textContent).toBe('seats');
    expect(row('P-002-004').querySelector('.opt__seats-label')?.textContent).toBe('waitlist');
  });

  it('a waitlist-only row is not treated as full', () => {
    // It has seats; greying it out would say the wrong thing about the same row.
    render('SE-P-001-001');
    expect(row('P-002-002').classList.contains('opt--full')).toBe(false);
    expect(row('P-002-004').classList.contains('opt--full')).toBe(true);
  });

  it('collapsed, the warning triangle rides along with the selected code', () => {
    // Folded away, that code is the only trace of the pick — same argument that
    // already puts the greyed-out treatment on a full selection. No room for the
    // words there, so the road sign carries the fact instead.
    render('SE-P-002-002', true);
    const mark = container.querySelector('.picker__selected .picker__wl');
    expect(container.querySelector('.picker__selected')?.textContent).toContain('P-002-002');
    expect(mark?.getAttribute('aria-label')).toBe('Waitlist only');
    expect(mark?.querySelector('svg')).not.toBeNull();
  });

  it('collapsed on an ordinary section, no mark', () => {
    render('SE-P-001-001', true);
    expect(container.querySelector('.picker__selected')?.textContent).toBe('P-001-001');
    expect(container.querySelector('.picker__wl')).toBeNull();
  });
});

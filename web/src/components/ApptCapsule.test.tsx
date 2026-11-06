/** Rendered with `createRoot` + `act`, like the other component tests here. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApptTimes, Term } from '@triton/shared';
import { ApptCapsule } from './ApptCapsule';

let mobile = false;
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fall: ApptTimes = {
  academicYear: '2026', academicSession: '2', yearText: '2026/2027', sessionText: 'Fall Quarter',
  capturedAt: '2026-08-01T12:00:00Z',
  windows: [{ label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z' }],
};
const winter: ApptTimes = {
  academicYear: '2026', academicSession: '3', yearText: '2026/2027', sessionText: 'Winter Quarter',
  capturedAt: '2026-11-01T12:00:00Z',
  windows: [{ label: 'First Pass', beginsAt: '2026-11-10T23:20:00Z', endsAt: '2026-11-14T07:59:59Z' }],
};
const FALL_2026: Term = { year: '2026', period: '2', label: 'Fall 2026' };
const WINTER_2026: Term = { year: '2026', period: '3', label: 'Winter 2026' };
const FALL_2027: Term = { year: '2027', period: '2', label: 'Fall 2027' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mobile = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(appt: ApptTimes[], term: Term) {
  act(() => root.render(<ApptCapsule appt={appt} term={term} />));
}
const text = () => container.querySelector('.appt-capsule__text')!.textContent;

describe('ApptCapsule', () => {
  it('shows the viewed term only: Fall 2026 is over', () => {
    render([fall, winter], FALL_2026);
    expect(text()).toBe('Enrollment ended');
  });
  it('shows the next window of Winter 2026', () => {
    render([fall, winter], WINTER_2026);
    expect(text()).toBe('First Pass · 11/10 3:20 PM PT');
  });
  it('prompts for a term that was never captured, and the popover names it', () => {
    render([fall, winter], FALL_2027);
    expect(text()).toBe('Appointment times');
    act(() => container.querySelector<HTMLButtonElement>('.appt-capsule')!.click());
    expect(document.body.textContent).toContain('Not captured for Fall 2027 yet');
  });
  it('a record for the viewed term with no windows prompts, and the popover says none are listed', () => {
    render([fall, { ...winter, windows: [] }], WINTER_2026);
    expect(text()).toBe('Appointment times');
    act(() => container.querySelector<HTMLButtonElement>('.appt-capsule')!.click());
    expect(document.body.textContent).toContain('No enrollment windows listed for this term yet.');
  });
  it('renders nothing on mobile when the term has no data', () => {
    mobile = true;
    render([], FALL_2027);
    expect(container.innerHTML).toBe('');
  });
});

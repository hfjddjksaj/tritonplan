import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApptTimes } from '@triton/shared';
import { useApptTimes } from './useApptTimes';
import { makeTestBoot } from '../test/boot';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let push: (incoming: ApptTimes[]) => void = () => {};
vi.mock('../lib/bridge', () => ({
  installApptTimesListener: (cb: (incoming: ApptTimes[]) => void) => {
    push = cb;
    return () => {};
  },
}));

const appt = (academicSession: string, capturedAt: string): ApptTimes => ({
  academicYear: '2026',
  academicSession,
  yearText: '2026',
  sessionText: 's',
  windows: [],
  capturedAt,
});
const fall = appt('2', '2026-09-01T00:00:00Z');
const winter = appt('3', '2026-11-01T00:00:00Z');

describe('useApptTimes', () => {
  let container: HTMLDivElement;
  let root: Root;
  let value: ApptTimes[];
  let boot: ReturnType<typeof makeTestBoot>;

  function Probe() {
    value = useApptTimes(boot);
    return null;
  }

  beforeEach(async () => {
    boot = makeTestBoot({ appt: [fall] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('merges a push for another term and saves the merged list', async () => {
    const spy = vi.spyOn(boot.engine, 'setAppt');
    await act(async () => push([winter]));
    expect(value).toEqual([fall, winter]);
    expect(spy).toHaveBeenCalledWith([fall, winter]);
  });

  it('an empty push changes nothing', async () => {
    const spy = vi.spyOn(boot.engine, 'setAppt');
    await act(async () => push([]));
    expect(value).toEqual([fall]);
    expect(spy).not.toHaveBeenCalled();
  });
});

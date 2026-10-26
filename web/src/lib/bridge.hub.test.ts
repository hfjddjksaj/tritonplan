import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_SOURCE,
  PENDING_ADDS_KEY,
  installBridgeHub,
  installBridgeListener,
  installApptTimesListener,
  resetBridgeHubForTests,
  subscribeBridge,
} from './bridge';
import { makeCourse } from './fixtures';

const APPT = {
  academicYear: '2026',
  academicSession: '2',
  yearText: '2026/2027',
  sessionText: 'Fall Quarter',
  capturedAt: '2026-07-25T12:00:00Z',
  windows: [],
};

const planAdd = (id: string) => ({
  source: BRIDGE_SOURCE,
  type: 'plan-add',
  version: 1,
  payload: { course: makeCourse(id), selectedOptionId: `${id}-opt` },
});
const apptMsg = { source: BRIDGE_SOURCE, type: 'appt-times', version: 1, payload: [APPT] };
const idOf = (d: unknown) => (d as { payload: { course: { id: string } } }).payload.course.id;

/** Synchronous stand-in for postMessage: source === window, origin === location.origin. */
function post(data: unknown, init: Partial<MessageEventInit> = {}) {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: window, origin: window.location.origin, ...init }),
  );
}

beforeEach(() => {
  resetBridgeHubForTests();
  sessionStorage.clear();
});
afterEach(() => {
  resetBridgeHubForTests();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('bridge hub', () => {
  it('a plan-add posted before anyone listens is delivered when usePlan subscribes', () => {
    installBridgeHub();
    post(planAdd('A'));
    const onPlanAdd = vi.fn();
    const off = installBridgeListener({ onCourses: vi.fn(), onPlanAdd });
    expect(onPlanAdd).toHaveBeenCalledTimes(1);
    expect(onPlanAdd.mock.calls[0][0].id).toBe('A');
    off();
  });

  it('appt-times waits for its own listener and is not swallowed by the plan listener', () => {
    installBridgeHub();
    post(apptMsg);
    const onPlanAdd = vi.fn();
    const offPlan = installBridgeListener({ onCourses: vi.fn(), onPlanAdd });
    expect(onPlanAdd).not.toHaveBeenCalled();
    const onAppt = vi.fn();
    const offAppt = installApptTimesListener(onAppt);
    expect(onAppt).toHaveBeenCalledTimes(1);
    expect(onAppt.mock.calls[0][0]).toEqual([APPT]);
    offPlan();
    offAppt();
  });

  it('after subscribing, live messages arrive exactly once', () => {
    installBridgeHub();
    installBridgeHub(); // idempotent: still one listener
    const handler = vi.fn();
    const off = subscribeBridge(['plan-add'], handler);
    post(planAdd('A'));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    post(planAdd('B'));
    expect(handler).toHaveBeenCalledTimes(1);
    // B queued for the next subscriber, delivered once.
    const second = vi.fn();
    subscribeBridge(['plan-add'], second)();
    expect(second).toHaveBeenCalledTimes(1);
    const third = vi.fn();
    subscribeBridge(['plan-add'], third);
    expect(third).not.toHaveBeenCalled();
  });

  it('replays queued messages in arrival order', () => {
    installBridgeHub();
    post(planAdd('A'));
    post(planAdd('B'));
    const seen: string[] = [];
    subscribeBridge(['plan-add'], (d) => seen.push(idOf(d)));
    expect(seen).toEqual(['A', 'B']);
  });

  it('StrictMode subscribe/unsubscribe/subscribe neither loses nor duplicates', () => {
    installBridgeHub();
    post(planAdd('A'));
    const h = vi.fn();
    subscribeBridge(['plan-add'], h)();
    subscribeBridge(['plan-add'], h);
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('a queued plan-add survives a reload (Google sign-in round trip)', () => {
    installBridgeHub();
    post(planAdd('A'));
    expect(sessionStorage.getItem(PENDING_ADDS_KEY)).not.toBeNull();
    resetBridgeHubForTests(); // full-page navigation: memory gone, sessionStorage stays
    installBridgeHub();
    const h = vi.fn();
    subscribeBridge(['plan-add'], h);
    expect(h).toHaveBeenCalledTimes(1);
    expect(idOf(h.mock.calls[0][0])).toBe('A');
    expect(sessionStorage.getItem(PENDING_ADDS_KEY)).toBeNull();
  });

  it('drops invalid restored entries', () => {
    sessionStorage.setItem(PENDING_ADDS_KEY, JSON.stringify([{ type: 'plan-add' }, 5, null]));
    installBridgeHub();
    const h = vi.fn();
    subscribeBridge(['plan-add'], h);
    expect(h).not.toHaveBeenCalled();
    sessionStorage.setItem(PENDING_ADDS_KEY, '{not json');
    resetBridgeHubForTests();
    expect(() => installBridgeHub()).not.toThrow();
  });

  it('messages from another origin or another window are ignored', () => {
    installBridgeHub();
    post(planAdd('A'), { origin: 'https://evil.example' });
    post(planAdd('B'), { source: null });
    post({ ...planAdd('C'), source: 'other' });
    post({ source: BRIDGE_SOURCE, type: 'plan-add', version: 1, payload: {} });
    const h = vi.fn();
    subscribeBridge(['plan-add'], h);
    expect(h).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_ADDS_KEY)).toBeNull();
  });

  it('works in memory when sessionStorage throws', () => {
    for (const m of ['setItem', 'getItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error('blocked');
      });
    }
    installBridgeHub();
    post(planAdd('A'));
    const h = vi.fn();
    subscribeBridge(['plan-add'], h);
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('caps each kind queue at the latest 200 messages', () => {
    installBridgeHub();
    for (let i = 0; i < 205; i++) post(planAdd(`c${i}`));
    const ids: string[] = [];
    subscribeBridge(['plan-add'], (d) => ids.push(idOf(d)));
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('c5');
  });
});

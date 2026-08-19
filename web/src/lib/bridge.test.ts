import { describe, it, expect, vi } from 'vitest';
import type { ApptTimes, BridgeMessage, BookedModule } from '@triton/shared';
import {
  isBridgeMessage,
  isCoursesMessage,
  isPlanAddMessage,
  mergeCourses,
  installBridgeListener,
  isApptTimesMessage,
  installApptTimesListener,
  postForgetCourses,
  BRIDGE_SOURCE,
  type PlanAddMessage,
  isBookedMessage,
  type BookedMessage,
  postOpenTssHome,
} from './bridge';
import { makeCourse } from './fixtures';
import { TSS_HOME_URL } from './tss';

const APPT: ApptTimes = {
  academicYear: '2026',
  academicSession: '2',
  yearText: '2026/2027',
  sessionText: 'Fall Quarter',
  capturedAt: '2026-07-25T12:00:00Z',
  windows: [
    { label: 'First Pass', beginsAt: '2026-08-10T21:00:00Z', endsAt: '2026-08-14T05:59:59Z', unitCap: '11.50', waitlists: 'Not Allowed' },
    { label: 'Second Pass', beginsAt: '2026-08-21T17:00:00Z', endsAt: '2026-08-27T05:59:59Z', unitCap: '19.50', waitlists: 'Allowed' },
  ],
};

describe('isCoursesMessage', () => {
  it('accepts a valid envelope (and the isBridgeMessage alias)', () => {
    const msg: BridgeMessage = { source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: [] };
    expect(isCoursesMessage(msg)).toBe(true);
    expect(isBridgeMessage(msg)).toBe(true);
  });

  it('rejects wrong source/type/version/shape', () => {
    expect(isCoursesMessage(null)).toBe(false);
    expect(isCoursesMessage({ source: 'someone-else', type: 'courses', version: 1, payload: [] })).toBe(false);
    expect(isCoursesMessage({ source: BRIDGE_SOURCE, type: 'other', version: 1, payload: [] })).toBe(false);
    expect(isCoursesMessage({ source: BRIDGE_SOURCE, type: 'courses', version: 2, payload: [] })).toBe(false);
    expect(isCoursesMessage({ source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: 'x' })).toBe(false);
  });
});

describe('isPlanAddMessage', () => {
  const good: PlanAddMessage = {
    source: BRIDGE_SOURCE,
    type: 'plan-add',
    version: 1,
    payload: { course: makeCourse('A'), selectedOptionId: 'A-opt' },
  };

  it('accepts a valid plan-add envelope', () => {
    expect(isPlanAddMessage(good)).toBe(true);
  });

  it('does not confuse it with a courses message', () => {
    expect(isCoursesMessage(good)).toBe(false);
    expect(isPlanAddMessage({ source: BRIDGE_SOURCE, type: 'courses', version: 1, payload: [] })).toBe(false);
  });

  it('rejects missing/invalid payload fields', () => {
    expect(isPlanAddMessage({ ...good, payload: { course: makeCourse('A') } })).toBe(false); // no optionId
    expect(isPlanAddMessage({ ...good, payload: { selectedOptionId: 'x' } })).toBe(false); // no course
    expect(isPlanAddMessage({ ...good, payload: { course: { id: 5 }, selectedOptionId: 'x' } })).toBe(false);
    expect(isPlanAddMessage({ ...good, version: 2 })).toBe(false);
  });
});

describe('mergeCourses', () => {
  it('keeps units and title a section-only re-capture does not carry', () => {
    const full = { ...makeCourse('A'), title: 'Real Course Title', units: 4 };
    const { units: _units, ...partial } = makeCourse('A');
    const merged = mergeCourses([full], [{ ...partial, title: partial.courseCode }]);
    expect(merged[0]!.units).toBe(4);
    expect(merged[0]!.title).toBe('Real Course Title');
  });

  it('appends genuinely new courses', () => {
    const merged = mergeCourses([makeCourse('A')], [makeCourse('B')]);
    expect(merged.map((c) => c.id)).toEqual(['A', 'B']);
  });

  it('replaces an existing course (fresher scrape wins) without duplicating', () => {
    const stale = makeCourse('A', 'CSE-A', 4);
    const fresh = makeCourse('A', 'CSE-A', 2); // same id, different units
    const merged = mergeCourses([stale], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.units).toBe(2);
  });

  it('preserves existing order then adds new ones', () => {
    const merged = mergeCourses(
      [makeCourse('A'), makeCourse('B')],
      [makeCourse('B'), makeCourse('C')],
    );
    expect(merged.map((c) => c.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('installBridgeListener', () => {
  /** A message event as the extension's content script produces it: same window, same origin. */
  function trustedEvent(data: unknown): MessageEvent {
    return new MessageEvent('message', {
      data,
      origin: window.location.origin,
      source: window,
    });
  }

  it('routes courses vs plan-add and ignores unknown, then stops after cleanup', () => {
    const onCourses = vi.fn();
    const onPlanAdd = vi.fn();
    const cleanup = installBridgeListener({ onCourses, onPlanAdd });

    // unknown / garbage: ignored
    window.dispatchEvent(trustedEvent('garbage'));
    expect(onCourses).not.toHaveBeenCalled();
    expect(onPlanAdd).not.toHaveBeenCalled();

    // courses message -> onCourses
    const coursesMsg: BridgeMessage = {
      source: BRIDGE_SOURCE,
      type: 'courses',
      version: 1,
      payload: [makeCourse('A')],
    };
    window.dispatchEvent(trustedEvent(coursesMsg));
    expect(onCourses).toHaveBeenCalledTimes(1);
    expect(onCourses.mock.calls[0]![0]).toHaveLength(1);
    expect(onPlanAdd).not.toHaveBeenCalled();

    // plan-add message -> onPlanAdd(course, optionId)
    const planAddMsg: PlanAddMessage = {
      source: BRIDGE_SOURCE,
      type: 'plan-add',
      version: 1,
      payload: { course: makeCourse('B'), selectedOptionId: 'B-opt' },
    };
    window.dispatchEvent(trustedEvent(planAddMsg));
    expect(onPlanAdd).toHaveBeenCalledTimes(1);
    expect(onPlanAdd.mock.calls[0]![0].id).toBe('B');
    expect(onPlanAdd.mock.calls[0]![1]).toBe('B-opt');

    cleanup();
    window.dispatchEvent(trustedEvent(coursesMsg));
    window.dispatchEvent(trustedEvent(planAddMsg));
    expect(onCourses).toHaveBeenCalledTimes(1);
    expect(onPlanAdd).toHaveBeenCalledTimes(1);
  });

  it('rejects well-formed messages from a foreign origin or another window', () => {
    const onCourses = vi.fn();
    const onPlanAdd = vi.fn();
    const cleanup = installBridgeListener({ onCourses, onPlanAdd });

    const coursesMsg: BridgeMessage = {
      source: BRIDGE_SOURCE,
      type: 'courses',
      version: 1,
      payload: [makeCourse('A')],
    };

    // Spoofed origin (e.g. a hostile embedder posting into this window).
    window.dispatchEvent(
      new MessageEvent('message', { data: coursesMsg, origin: 'https://evil.example', source: window }),
    );
    // Right origin but a different source window (e.g. an embedded iframe).
    window.dispatchEvent(
      new MessageEvent('message', { data: coursesMsg, origin: window.location.origin, source: null }),
    );

    expect(onCourses).not.toHaveBeenCalled();
    expect(onPlanAdd).not.toHaveBeenCalled();
    cleanup();
  });

  it('routes booked envelopes to onBooked', () => {
    const onCourses = vi.fn();
    const onPlanAdd = vi.fn();
    const onBooked = vi.fn();
    const cleanup = installBridgeListener({ onCourses, onPlanAdd, onBooked });
    window.dispatchEvent(
      trustedEvent({ source: BRIDGE_SOURCE, type: 'booked', version: 1, payload: [BOOKED_ROW] }),
    );
    expect(onBooked).toHaveBeenCalledTimes(1);
    expect(onBooked.mock.calls[0]![0]).toEqual([BOOKED_ROW]);
    expect(onCourses).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('appt-times bridge', () => {
  it('accepts a valid appt-times envelope', () => {
    expect(
      isApptTimesMessage({
        source: 'triton-planner-extension',
        type: 'appt-times',
        version: 1,
        payload: [APPT],
      }),
    ).toBe(true);
  });

  it('rejects wrong source/type/payload', () => {
    expect(isApptTimesMessage({ source: 'evil', type: 'appt-times', version: 1, payload: [APPT] })).toBe(false);
    expect(isApptTimesMessage({ source: 'triton-planner-extension', type: 'appt-times', version: 1, payload: [{ nope: 1 }] })).toBe(false);
    expect(isApptTimesMessage({ source: 'triton-planner-extension', type: 'courses', version: 1, payload: [APPT] })).toBe(false);
  });

  it('installApptTimesListener fires on valid messages only', () => {
    /** A message event as the extension's content script produces it: same window, same origin. */
    function trustedEvent(data: unknown): MessageEvent {
      return new MessageEvent('message', {
        data,
        origin: window.location.origin,
        source: window,
      });
    }

    const onApptTimes = vi.fn();
    const cleanup = installApptTimesListener(onApptTimes);

    // unknown / garbage: ignored
    window.dispatchEvent(trustedEvent('garbage'));
    expect(onApptTimes).not.toHaveBeenCalled();

    // forged source: ignored
    const forgedMsg = { source: 'evil', type: 'appt-times', version: 1, payload: [APPT] };
    window.dispatchEvent(trustedEvent(forgedMsg));
    expect(onApptTimes).not.toHaveBeenCalled();

    // valid appt-times message -> onApptTimes(payload)
    const apptMsg = {
      source: BRIDGE_SOURCE,
      type: 'appt-times' as const,
      version: 1 as const,
      payload: [APPT],
    };
    window.dispatchEvent(trustedEvent(apptMsg));
    expect(onApptTimes).toHaveBeenCalledTimes(1);
    expect(onApptTimes.mock.calls[0]![0]).toEqual([APPT]);

    cleanup();
    window.dispatchEvent(trustedEvent(apptMsg));
    expect(onApptTimes).toHaveBeenCalledTimes(1);
  });
});

const BOOKED_ROW: BookedModule = {
  courseCode: 'CHEM-114A',
  moduleId: '2077',
  term: { year: '2026', period: '2', label: 'Fall 2026' },
};

describe('isBookedMessage', () => {
  const good: BookedMessage = { source: BRIDGE_SOURCE, type: 'booked', version: 1, payload: [BOOKED_ROW] };

  it('accepts a valid envelope, including an EMPTY payload (= zero bookings)', () => {
    expect(isBookedMessage(good)).toBe(true);
    expect(isBookedMessage({ ...good, payload: [] })).toBe(true);
  });

  it('rejects malformed rows and foreign envelopes', () => {
    expect(isBookedMessage({ ...good, source: 'someone-else' })).toBe(false);
    expect(isBookedMessage({ ...good, version: 2 })).toBe(false);
    expect(isBookedMessage({ ...good, payload: [{ courseCode: 'X' }] })).toBe(false);
    expect(isBookedMessage({ ...good, payload: [{ ...BOOKED_ROW, term: 'Fall' }] })).toBe(false);
  });
});

describe('postForgetCourses', () => {
  it('posts the forget-courses envelope to the page origin', () => {
    const posted: unknown[] = [];
    const orig = window.postMessage.bind(window);
    window.postMessage = ((msg: unknown) => { posted.push(msg); }) as typeof window.postMessage;
    try {
      postForgetCourses(['8461', '8462']);
      expect(posted).toEqual([
        { source: 'triton-planner-page', type: 'forget-courses', version: 1, payload: { moduleIds: ['8461', '8462'] } },
      ]);
      postForgetCourses([]);
      expect(posted).toHaveLength(1); // empty list posts nothing
    } finally {
      window.postMessage = orig;
    }
  });
});

describe('booked freshness rides along optionally', () => {
  const good: BookedMessage = { source: BRIDGE_SOURCE, type: 'booked', version: 1, payload: [BOOKED_ROW] };

  it('hands capturedAt to the handler when present, undefined when not', () => {
    const seen: (string | undefined)[] = [];
    const off = installBridgeListener({
      onCourses: () => {}, onPlanAdd: () => {},
      onBooked: (_rows, at) => seen.push(at),
    });
    try {
      window.dispatchEvent(new MessageEvent('message', {
        data: { ...good, capturedAt: '2026-08-19T00:00:00.000Z' },
        source: window, origin: window.location.origin,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: good, source: window, origin: window.location.origin,
      }));
    } finally {
      off();
    }
    expect(seen).toEqual(['2026-08-19T00:00:00.000Z', undefined]);
  });

  it('still validates the envelope with capturedAt attached', () => {
    expect(isBookedMessage({ ...good, capturedAt: 'whenever' })).toBe(true);
  });
});

describe('postOpenTssHome', () => {
  it('posts the open-tss-home envelope so the extension can reuse a TSS tab', () => {
    const posted: unknown[] = [];
    const orig = window.postMessage.bind(window);
    window.postMessage = ((msg: unknown) => { posted.push(msg); }) as typeof window.postMessage;
    try {
      postOpenTssHome(TSS_HOME_URL);
      expect(posted).toEqual([
        {
          source: 'triton-planner-page',
          type: 'open-tss-home',
          version: 1,
          payload: { url: TSS_HOME_URL },
        },
      ]);
    } finally {
      window.postMessage = orig;
    }
  });
});

/**
 * An extension holding nothing used to say nothing, so a planner that had once been
 * pushed to went on claiming TSS had reported — forever, and wrongly. `captured` is
 * the sentence that was missing.
 */
describe('booked captured flag', () => {
  const good: BookedMessage = { source: BRIDGE_SOURCE, type: 'booked', version: 1, payload: [BOOKED_ROW] };

  function seen(data: unknown): { rows: number; captured?: boolean }[] {
    const got: { rows: number; captured?: boolean }[] = [];
    const off = installBridgeListener({
      onCourses: () => {}, onPlanAdd: () => {},
      onBooked: (rows, _at, captured) => got.push({ rows: rows.length, captured }),
    });
    try {
      window.dispatchEvent(new MessageEvent('message', {
        data, source: window, origin: window.location.origin,
      }));
    } finally {
      off();
    }
    return got;
  }

  it('passes captured:false through, so the page can drop a sync it can no longer back', () => {
    expect(seen({ ...good, payload: [], captured: false })).toEqual([{ rows: 0, captured: false }]);
  });

  it('leaves it undefined for older extensions, which only spoke when they had one', () => {
    expect(seen(good)).toEqual([{ rows: 1, captured: undefined }]);
  });

  it('an empty payload WITH captured:true is still a real report of zero bookings', () => {
    expect(seen({ ...good, payload: [], captured: true })).toEqual([{ rows: 0, captured: true }]);
  });
});

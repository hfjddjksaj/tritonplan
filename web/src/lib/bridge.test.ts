import { describe, it, expect, vi } from 'vitest';
import type { BridgeMessage } from '@triton/shared';
import {
  isBridgeMessage,
  isCoursesMessage,
  isPlanAddMessage,
  mergeCourses,
  installBridgeListener,
  BRIDGE_SOURCE,
  type PlanAddMessage,
} from './bridge';
import { makeCourse } from './fixtures';

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
  it('routes courses vs plan-add and ignores unknown, then stops after cleanup', () => {
    const onCourses = vi.fn();
    const onPlanAdd = vi.fn();
    const cleanup = installBridgeListener({ onCourses, onPlanAdd });

    // unknown / garbage: ignored
    window.dispatchEvent(new MessageEvent('message', { data: 'garbage' }));
    expect(onCourses).not.toHaveBeenCalled();
    expect(onPlanAdd).not.toHaveBeenCalled();

    // courses message -> onCourses
    const coursesMsg: BridgeMessage = {
      source: BRIDGE_SOURCE,
      type: 'courses',
      version: 1,
      payload: [makeCourse('A')],
    };
    window.dispatchEvent(new MessageEvent('message', { data: coursesMsg }));
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
    window.dispatchEvent(new MessageEvent('message', { data: planAddMsg }));
    expect(onPlanAdd).toHaveBeenCalledTimes(1);
    expect(onPlanAdd.mock.calls[0]![0].id).toBe('B');
    expect(onPlanAdd.mock.calls[0]![1]).toBe('B-opt');

    cleanup();
    window.dispatchEvent(new MessageEvent('message', { data: coursesMsg }));
    window.dispatchEvent(new MessageEvent('message', { data: planAddMsg }));
    expect(onCourses).toHaveBeenCalledTimes(1);
    expect(onPlanAdd).toHaveBeenCalledTimes(1);
  });
});

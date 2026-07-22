import { describe, it, expect } from 'vitest';
import {
  blockGeometry,
  assignLanes,
  layoutWeek,
  visibleDays,
  hourMarks,
  gridHeightPx,
  type MeetingInstance,
  type GridConfig,
} from './layout';

const cfg: GridConfig = { startHour: 7, endHour: 22, pxPerMinute: 1 };

function inst(partial: Partial<MeetingInstance>): MeetingInstance {
  return {
    courseId: 'C',
    courseCode: 'CSE-1',
    typeText: 'Lecture',
    hue: 231,
    start: '09:00',
    end: '10:00',
    day: 'Mon',
    ...partial,
  };
}

describe('blockGeometry', () => {
  it('maps minutes-from-start to top/height at 1px/min', () => {
    // 09:00 is 120 min after 07:00
    expect(blockGeometry('09:00', '10:20', cfg)).toEqual({ top: 120, height: 80 });
  });

  it('clamps a meeting that starts before the visible window', () => {
    const g = blockGeometry('06:30', '07:30', cfg);
    expect(g.top).toBe(0);
    expect(g.height).toBe(30); // only 07:00–07:30 is visible
  });

  it('clamps a meeting that runs past the visible window', () => {
    const g = blockGeometry('21:30', '23:00', cfg);
    expect(g.top).toBe(870); // 14.5h * 60
    expect(g.height).toBe(30); // clamped at 22:00
  });
});

describe('hourMarks / gridHeightPx', () => {
  it('lists inclusive hour marks and total height', () => {
    expect(hourMarks(cfg)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(gridHeightPx(cfg)).toBe(900); // 15h * 60
  });
});

describe('assignLanes', () => {
  it('gives non-overlapping meetings a single full-width lane each', () => {
    const laned = assignLanes([
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' }, // touches, does not overlap
    ]);
    expect(laned.every((m) => m.laneCount === 1 && m.lane === 0)).toBe(true);
  });

  it('splits two overlapping meetings into two lanes', () => {
    const laned = assignLanes([
      { start: '09:00', end: '10:00' },
      { start: '09:30', end: '10:30' },
    ]);
    expect(laned.map((m) => m.lane).sort()).toEqual([0, 1]);
    expect(laned.every((m) => m.laneCount === 2)).toBe(true);
  });

  it('reuses a freed lane after a cluster gap', () => {
    const laned = assignLanes([
      { start: '09:00', end: '10:00' },
      { start: '09:30', end: '10:30' }, // cluster A: 2 lanes
      { start: '13:00', end: '14:00' }, // cluster B: 1 lane
    ]);
    const b = laned.find((m) => m.start === '13:00')!;
    expect(b.laneCount).toBe(1);
    expect(b.lane).toBe(0);
  });
});

describe('layoutWeek', () => {
  it('positions blocks per day and records used days', () => {
    const { byDay, usedDays } = layoutWeek(
      [inst({ day: 'Mon' }), inst({ day: 'Wed', start: '14:00', end: '15:00' })],
      cfg,
    );
    expect(byDay.Mon).toHaveLength(1);
    expect(byDay.Wed).toHaveLength(1);
    expect(byDay.Tue).toHaveLength(0);
    expect([...usedDays].sort()).toEqual(['Mon', 'Wed']);
  });

  it('flags blocks from different courses that overlap on the same day', () => {
    const { byDay } = layoutWeek(
      [
        inst({ courseId: 'A', start: '09:00', end: '10:00' }),
        inst({ courseId: 'B', start: '09:30', end: '10:30' }),
      ],
      cfg,
    );
    expect(byDay.Mon.every((b) => b.conflict)).toBe(true);
  });

  it('does not flag same-course meetings that happen to overlap', () => {
    const { byDay } = layoutWeek(
      [
        inst({ courseId: 'A', start: '09:00', end: '10:00' }),
        inst({ courseId: 'A', start: '09:30', end: '10:30' }),
      ],
      cfg,
    );
    expect(byDay.Mon.some((b) => b.conflict)).toBe(false);
  });
});

describe('visibleDays', () => {
  it('shows Mon–Fri by default', () => {
    expect(visibleDays(new Set())).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });
  it('adds weekend columns only when used', () => {
    expect(visibleDays(new Set(['Sat']))).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(visibleDays(new Set(['Sun', 'Sat']))).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
  });
});

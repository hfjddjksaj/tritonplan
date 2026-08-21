import { describe, it, expect } from 'vitest';
import type { TermWorkspace } from './terms-state';
import {
  bookedSet,
  applyAutoBooked,
  forgetAutoBooked,
  isAutoBookedSynced,
  toggleBooked,
  applyAutoWaitlisted,
  waitlistedSet,
} from './booked';

const TERM = { year: '2026', period: '2', label: 'Fall 2026' };
function ws(partial: Partial<TermWorkspace> = {}): TermWorkspace {
  return {
    term: TERM,
    plans: { activeId: 'p1', plans: [{ id: 'p1', name: 'My plan', plan: { version: 1, term: TERM, entries: [] }, createdAt: 't', updatedAt: 't', browsed: [] }] },
    ...partial,
  };
}
const A = 'CHEM-114A|2026|2';
const B = 'CHEM-152|2026|2';

describe('bookedSet', () => {
  it('is (auto ∪ on) − off; absent fields are empty', () => {
    expect([...bookedSet(ws())]).toEqual([]);
    expect([...bookedSet(ws({ bookedAuto: [A], bookedOn: [B], bookedOff: [A] }))]).toEqual([B]);
  });
});

describe('toggleBooked', () => {
  it('marks a non-booked course via bookedOn', () => {
    const next = toggleBooked(ws(), A);
    expect(next.bookedOn).toEqual([A]);
    expect(bookedSet(next).has(A)).toBe(true);
  });
  it('unmarks an auto-booked course via bookedOff (auto list untouched)', () => {
    const next = toggleBooked(ws({ bookedAuto: [A] }), A);
    expect(next.bookedAuto).toEqual([A]);
    expect(next.bookedOff).toEqual([A]);
    expect(bookedSet(next).has(A)).toBe(false);
  });
  it('unmarking a manual mark just removes it from bookedOn', () => {
    const marked = toggleBooked(ws(), A);
    const next = toggleBooked(marked, A);
    expect(next.bookedOn).toEqual([]);
    expect(next.bookedOff ?? []).toEqual([]);
  });
});

describe('applyAutoBooked (self-healing)', () => {
  it('replaces the auto list wholesale', () => {
    const next = applyAutoBooked(ws({ bookedAuto: [A] }), [B]);
    expect(next.bookedAuto).toEqual([B]);
    expect(bookedSet(next).has(A)).toBe(false); // dropped course auto-clears
  });
  it('prunes bookedOn entries the feed now confirms', () => {
    const next = applyAutoBooked(ws({ bookedOn: [A] }), [A]);
    expect(next.bookedOn).toEqual([]);
    expect(bookedSet(next).has(A)).toBe(true);
  });
  it('prunes bookedOff entries the feed no longer contradicts', () => {
    const next = applyAutoBooked(ws({ bookedAuto: [A], bookedOff: [A] }), []);
    expect(next.bookedOff).toEqual([]);
    expect(bookedSet(next).has(A)).toBe(false);
  });
  it('TSS overrules a standing unmark: what the feed reports comes out booked', () => {
    // The unmark used to win forever. One student's three enrolled courses stayed
    // dark for days that way, with the feed reporting all three on every read.
    const next = applyAutoBooked(ws({ bookedAuto: [A], bookedOff: [A] }), [A]);
    expect(next.bookedOff).toEqual([]);
    expect(bookedSet(next).has(A)).toBe(true);
  });
  it('returns the SAME reference when nothing changes', () => {
    const w = ws({ bookedAuto: [A] });
    expect(applyAutoBooked(w, [A])).toBe(w);
  });
});

describe('isAutoBookedSynced', () => {
  it('is false until a booked push lands — a manual mark is not a sync', () => {
    expect(isAutoBookedSynced(ws())).toBe(false);
    expect(isAutoBookedSynced(ws({ bookedOn: [A] }))).toBe(false);
  });
  it('is true once the feed has reported, even when the student books nothing', () => {
    expect(isAutoBookedSynced(applyAutoBooked(ws(), []))).toBe(true);
    expect(isAutoBookedSynced(ws({ bookedAuto: [A] }))).toBe(true);
  });
});

describe('forgetAutoBooked', () => {
  it('drops the captured half and leaves hand marks alone', () => {
    const next = forgetAutoBooked(ws({ bookedAuto: [A], bookedOn: [B], bookedOff: [A] }));
    expect(isAutoBookedSynced(next)).toBe(false);
    expect(next.bookedOn).toEqual([B]);
    expect(next.bookedOff).toEqual([A]);
    expect([...bookedSet(next)]).toEqual([B]);
  });
  it('is a no-op when nothing was ever captured', () => {
    const before = ws({ bookedOn: [A] });
    expect(forgetAutoBooked(before)).toBe(before);
  });
});

describe('waitlisted courses', () => {
  it('are their own list, and never leak into the booked one', () => {
    // A place in the queue is not an enrolment. Painting it green would tell a
    // student to stop worrying about a course they have not got.
    const w = applyAutoWaitlisted(ws({ bookedAuto: [A] }), [B]);
    expect([...bookedSet(w)]).toEqual([A]);
    expect([...waitlistedSet(w)]).toEqual([B]);
  });

  it('are empty when TSS has said nothing about them', () => {
    expect([...waitlistedSet(ws())]).toEqual([]);
  });

  it('are replaced wholesale, like the booked list — a drop clears itself', () => {
    const w = applyAutoWaitlisted(ws({ waitlistedAuto: [A, B] }), [B]);
    expect([...waitlistedSet(w)]).toEqual([B]);
  });

  it('leave the workspace object alone when nothing changed', () => {
    const before = ws({ waitlistedAuto: [A] });
    expect(applyAutoWaitlisted(before, [A])).toBe(before);
  });

  it('are forgotten with the rest of the capture', () => {
    // Same push wrote both; an extension that no longer holds a capture cannot
    // stand behind either half.
    const w = forgetAutoBooked(ws({ bookedAuto: [A], waitlistedAuto: [B], bookedOn: [A] }));
    expect(w.bookedAuto).toBeUndefined();
    expect(w.waitlistedAuto).toBeUndefined();
    expect(w.bookedOn).toEqual([A]); // the student's own marks are not the capture
  });
});

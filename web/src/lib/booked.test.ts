import { describe, it, expect } from 'vitest';
import type { TermWorkspace } from './terms-state';
import { bookedSet, applyAutoBooked, isAutoBookedSynced, toggleBooked } from './booked';

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
  it('keeps a still-contradicted bookedOff', () => {
    const next = applyAutoBooked(ws({ bookedAuto: [A], bookedOff: [A] }), [A]);
    expect(next.bookedOff).toEqual([A]);
    expect(bookedSet(next).has(A)).toBe(false);
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

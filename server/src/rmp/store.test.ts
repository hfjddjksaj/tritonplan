import { expect, test } from 'vitest';
import { openDb } from '../db/db';
import type { RmpTeacher } from './fetch';
import { lookupTeachers, nameKey, replaceTeachers, rmpFetchedAt } from './store';

const t = (legacyId: number, firstName: string, lastName: string, over: Partial<RmpTeacher> = {}): RmpTeacher => ({
  legacyId, firstName, lastName, department: 'Computer Science', avgRating: 4.5, numRatings: 10, ...over,
});

test('nameKey trims, collapses spaces, folds case and accents', () => {
  const k = nameKey('leo porter');
  expect(nameKey('Leo  Porter ')).toBe(k);
  expect(nameKey('Léo Porter')).toBe(k);
  expect(nameKey('  LEO\tPORTER')).toBe(k);
  expect(k).toBe('leo porter');
  expect(nameKey('Leo Porter Jr')).not.toBe(k);
});

test('a unique exact name matches; a shared name or a partial name does not', () => {
  const db = openDb(':memory:');
  replaceTeachers(db, [
    t(1, 'Leo ', 'Porter', { numRatings: 0, avgRating: 0 }), // RMP's trailing space on firstName
    t(2, 'Joe', 'Politz'),
    t(3, 'Joe', 'Politz'),
    t(4, 'Mia', 'Chen', { department: null }),
    t(5, 'Mia Ann', 'Chen'),
  ], '2026-01-15T00:00:00.000Z');

  const [leo, politz, partial, mia, none] = lookupTeachers(db, ['Léo  Porter', 'Joe Politz', 'Chen', 'mia chen', 'Nobody Here']);
  expect(leo!.match).toEqual({
    legacyId: 1, firstName: 'Leo', lastName: 'Porter', department: 'Computer Science',
    avgRating: null, numRatings: 0, url: 'https://www.ratemyprofessors.com/professor/1',
  });
  expect(leo!.name).toBe('Léo  Porter');
  expect(politz!.match).toBeNull(); // two people share it: no guess
  expect(partial!.match).toBeNull();
  expect(mia!.match).toMatchObject({ legacyId: 4, department: null, avgRating: 4.5 });
  expect(none!.match).toBeNull();
  expect(none!.searchUrl).toBe('https://www.ratemyprofessors.com/search/professors/1079?q=Nobody%20Here');
  expect(politz!.searchUrl).toBe('https://www.ratemyprofessors.com/search/professors/1079?q=Joe%20Politz');
  expect(lookupTeachers(db, [])).toEqual([]);
});

test('replaceTeachers swaps the whole snapshot and stamps the time, atomically', () => {
  const db = openDb(':memory:');
  expect(rmpFetchedAt(db)).toBeNull();
  replaceTeachers(db, [t(1, 'A', 'One'), t(2, 'B', 'Two')], '2026-01-01T00:00:00.000Z');
  replaceTeachers(db, [t(3, 'C', 'Three'), t(3, 'C', 'Three')], '2026-02-01T00:00:00.000Z'); // a repeated id must not abort it
  expect(rmpFetchedAt(db)).toBe('2026-02-01T00:00:00.000Z');
  expect(db.prepare('SELECT legacy_id FROM rmp_teachers').all()).toEqual([{ legacy_id: 3 }]);

  const bad = { ...t(9, 'X', 'Y'), numRatings: null } as unknown as RmpTeacher;
  expect(() => replaceTeachers(db, [t(4, 'D', 'Four'), bad], '2026-03-01T00:00:00.000Z')).toThrow();
  expect(db.prepare('SELECT legacy_id FROM rmp_teachers').all()).toEqual([{ legacy_id: 3 }]);
  expect(rmpFetchedAt(db)).toBe('2026-02-01T00:00:00.000Z');
});

import { describe, it, expect } from 'vitest';
import { matchBuilding, googleMapsLink } from './buildings';
import dataset from '../data/ucsd-buildings.json';
import { BUILDING_ALIASES } from './building-aliases';

describe('matchBuilding', () => {
  it('matches an exact official name (case/whitespace tolerant)', () => {
    expect(matchBuilding('Galbraith Hall')?.name).toBe('Galbraith Hall');
    expect(matchBuilding('  galbraith   hall ')?.name).toBe('Galbraith Hall');
  });

  it('matches an official alias', () => {
    expect(matchBuilding('Undergraduate Sciences Building')?.name).toBe('York Hall');
  });

  it('normalizes roman numerals (Unit 2 ↔ Unit II)', () => {
    expect(matchBuilding('Engineering Building Unit 2')?.name).toBe('Engineering Building Unit II');
  });

  it('normalizes "&" to "and"', () => {
    expect(matchBuilding('Design & Innovation Building')?.name).toBe('Design and Innovation Building');
  });

  it('treats a trailing "Building" as optional on both sides', () => {
    expect(matchBuilding('Applied Physics and Mathematics Building')?.name).toBe(
      'Applied Physics and Mathematics',
    );
    expect(matchBuilding('Humanities and Social Sciences Building')?.name).toBe(
      'Humanities and Social Sciences',
    );
  });

  it('repairs the real 40-char TSS truncation via unique prefix', () => {
    expect(matchBuilding('Computer Science and Engineering Buildin')?.name).toBe(
      'Computer Science and Engineering Building',
    );
  });

  it('rejects prefixes shared by different buildings', () => {
    expect(matchBuilding('Pepper Canyon')).toBeNull(); // Hall vs Apartments vs Lodge…
    expect(matchBuilding('Price Cent')).toBeNull(); // West vs East Expansion
  });

  it('still matches a full name that is also a prefix of longer names', () => {
    expect(matchBuilding('Pepper Canyon Hall')?.name).toBe('Pepper Canyon Hall');
  });

  it('returns coordinates for the maps link', () => {
    const hit = matchBuilding('York Hall');
    expect(hit?.lat).toBeCloseTo(32.8745, 3);
    expect(hit?.lng).toBeCloseTo(-117.24, 2);
  });

  it('returns null for unknown, too-short, or missing names', () => {
    expect(matchBuilding('Totally Unknown Hall')).toBeNull();
    expect(matchBuilding('Ga')).toBeNull();
    expect(matchBuilding(undefined)).toBeNull();
  });
});

describe('dataset sanity', () => {
  it('carries the full campus', () => {
    expect(dataset.buildings.length).toBeGreaterThan(700);
  });

  it('resolves every building seen in real TSS fixtures', () => {
    for (const n of ['York Hall', 'Center Hall', 'Galbraith Hall', 'Warren Lecture Hall']) {
      expect(matchBuilding(n), n).not.toBeNull();
    }
  });
});

describe('googleMapsLink', () => {
  it('pins exact coordinates for a matched building', () => {
    expect(googleMapsLink({ lat: 32.87451, lng: -117.24 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=32.87451%2C-117.24',
    );
  });

  it('falls back to a campus-scoped text search for raw names', () => {
    expect(googleMapsLink('Galbraith Hall')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Galbraith%20Hall%2C%20UC%20San%20Diego',
    );
  });
});

describe('hand-curated overlay', () => {
  it('maps Ledden Auditorium into the HSS complex', () => {
    const hit = matchBuilding('Ledden Auditorium');
    expect(hit?.name).toBe('Humanities and Social Sciences');
    expect(hit?.lat).toBeCloseTo(32.87851, 3);
  });

  it('maps Rady School of Management to Otterson Hall', () => {
    expect(matchBuilding('Rady School of Management')?.name).toBe('Otterson Hall');
  });

  it('maps Price Center to Price Center West', () => {
    expect(matchBuilding('Price Center')?.name).toBe('Price Center West');
  });

  it('every overlay alias targets an existing official record', () => {
    for (const target of Object.values(BUILDING_ALIASES)) {
      expect(matchBuilding(target), target).not.toBeNull();
    }
  });
});

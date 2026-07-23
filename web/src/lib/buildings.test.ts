import { describe, it, expect } from 'vitest';
import { canonicalBuilding, googleMapsLink } from './buildings';

describe('canonicalBuilding', () => {
  it('matches an exact name (case/whitespace tolerant)', () => {
    expect(canonicalBuilding('Galbraith Hall')).toBe('Galbraith Hall');
    expect(canonicalBuilding('  galbraith   hall ')).toBe('Galbraith Hall');
  });

  it('repairs a TSS-truncated name via unique prefix match', () => {
    expect(canonicalBuilding('Computer Science and Engineering Buildin')).toBe(
      'Computer Science and Engineering Building',
    );
    expect(canonicalBuilding('Pepper Canyon')).toBe('Pepper Canyon Hall');
  });

  it('returns null for unknown, too-short, or missing names', () => {
    expect(canonicalBuilding('Totally Unknown Hall')).toBeNull();
    expect(canonicalBuilding('Ga')).toBeNull();
    expect(canonicalBuilding(undefined)).toBeNull();
  });
});

describe('googleMapsLink', () => {
  it('builds an encoded campus-scoped search URL', () => {
    expect(googleMapsLink('Galbraith Hall')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Galbraith%20Hall%2C%20UC%20San%20Diego',
    );
  });
});

import { describe, it, expect } from 'vitest';
import { loadCampusGeo, type CampusLine } from './campus-geo';
import {
  DISTRICT_LABELS,
  buildingShortName,
  districtLabel,
  districtPriority,
  roadLabelText,
  wantsRoadLabel,
} from './map-names';

describe('districtLabel', () => {
  it('names districts the way students do', () => {
    expect(districtLabel('Ridge Walk North')).toBe('Marshall');
    expect(districtLabel('Roosevelt')).toBe('ERC');
    expect(districtLabel('North Torrey Pines')).toBe('Sixth');
    expect(districtLabel('Theatre District')).toBe('Eighth');
    expect(districtLabel('Revelle')).toBe('Revelle');
  });

  it('skips the slivers nobody needs named', () => {
    expect(districtLabel('Beach Properties')).toBeNull();
  });

  it('only maps district names that exist in the bundled data', async () => {
    const geo = await loadCampusGeo();
    const names = new Set(geo.districts.map((d) => d.name));
    for (const key of Object.keys(DISTRICT_LABELS)) expect(names.has(key), key).toBe(true);
  });
});

describe('districtPriority', () => {
  it('ranks the colleges ahead of the outlying districts', () => {
    expect(districtPriority('Warren')).toBeLessThan(districtPriority('Mesa Housing'));
    expect(districtPriority('University Center')).toBe(0);
  });

  it('ranks a college 0 and an outlying district 1', () => {
    expect(districtPriority('Muir')).toBe(0);
    expect(districtPriority('Scripps Institution')).toBe(1);
  });
});

describe('roadLabelText / wantsRoadLabel', () => {
  it('abbreviates the way street signs do', () => {
    expect(roadLabelText('North Torrey Pines Road')).toBe('N Torrey Pines Rd');
    expect(roadLabelText('La Jolla Village Drive')).toBe('La Jolla Village Dr');
    expect(roadLabelText('Scholars Drive North')).toBe('Scholars Dr N');
    expect(roadLabelText('Ridge Walk')).toBe('Ridge Walk');
    expect(roadLabelText('San Diego Freeway')).toBe('I-5');
  });

  it('labels every named highway and major road, but only listed minor ones', () => {
    const line = (name: string, kind: CampusLine['kind']): CampusLine => ({ name, kind, pts: [] });
    expect(wantsRoadLabel(line('Genesee Avenue', 'major'))).toBe(true);
    expect(wantsRoadLabel(line('', 'hwy'))).toBe(false);
    expect(wantsRoadLabel(line('Voigt Drive', 'minor'))).toBe(true);
    expect(wantsRoadLabel(line('Caminito Fresco', 'minor'))).toBe(false);
    expect(wantsRoadLabel(line('Library Walk', 'walk'))).toBe(true);
  });
});

describe('buildingShortName', () => {
  it('shortens stock words and refuses addresses and very long names', () => {
    expect(buildingShortName('Cognitive Science Building')).toBe('Cognitive Science Bldg');
    expect(buildingShortName('Applied Physics and Mathematics')).toBe('Applied Physics & Mathematics');
    expect(buildingShortName('9500 Gilman Drive')).toBeNull();
    expect(buildingShortName('Sanders Hall')).toBe('Sanders Hall'); // "and" inside a word survives
    expect(buildingShortName('Joan and Irwin Jacobs Center for La Jolla Playhouse')).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { classifyCapture } from './extract-odata.js';
import { FIX_DIR } from '../parser/fixtures.js';

/** The BC_OVP_BOOKED_MODULES_SRV/ModuleSet fixture (OData v2 `{"d":{"results":[...]}}`). */
function bookedModulesFixture(): unknown {
  return JSON.parse(readFileSync(resolve(FIX_DIR, 'booked-modules-fall2026.json'), 'utf8'));
}

describe('booked-modules classification (OData v2)', () => {
  it('classifies BC_OVP_BOOKED_MODULES rows out of an OData v2 body', () => {
    const bookedFixture = bookedModulesFixture();
    const body = JSON.stringify(bookedFixture);
    const { bookedRows, moduleRows, sectionRows } = classifyCapture(body);
    expect(bookedRows).toHaveLength(3);
    expect(bookedRows[0]).toMatchObject({ SmShort: 'CHEM-114A', SmObjid: '00002077', AcademicSession: '002' });
    expect(moduleRows).toHaveLength(0);
    expect(sectionRows).toHaveLength(0);
  });

  it('v2 bodies that are not booked rows are ignored', () => {
    expect(classifyCapture('{"d":{"results":[{"Foo":1}]}}').bookedRows).toEqual([]);
  });

  it('a malformed / non-JSON body yields no booked rows and isV2Doc=false, without throwing', () => {
    expect(() => classifyCapture('<?xml version="1.0"?><edmx:Edmx></edmx:Edmx>')).not.toThrow();
    const xml = classifyCapture('<?xml version="1.0"?><edmx:Edmx></edmx:Edmx>');
    expect(xml.bookedRows).toEqual([]);
    expect(xml.isV2Doc).toBe(false);
    const truncated = classifyCapture('{"d":{"results":[');
    expect(truncated.bookedRows).toEqual([]);
    expect(truncated.isV2Doc).toBe(false);
  });
});

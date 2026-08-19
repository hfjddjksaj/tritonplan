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

/**
 * SAP Fiori's launchpad batches its OData v2 reads: the response is a multipart
 * `$batch` document whose parts each hold one HTTP response, JSON body and all.
 * Reading only whole-body documents made every batched v2 payload invisible, so a
 * homepage load could fire the booked feed and still leave the store empty.
 */
function batchBody(parts: string[]): string {
  const B = '--batch_a1b2-c3d4-e5f6';
  return (
    parts
      .map(
        (p) =>
          `${B}\r\nContent-Type: application/http\r\ncontent-transfer-encoding: binary\r\n\r\n` +
          `HTTP/1.1 200 OK\r\nContent-Type: application/json;charset=utf-8\r\ncontent-length: ${p.length}\r\n\r\n${p}\r\n`,
      )
      .join('') + `${B}--\r\n`
  );
}

describe('OData v2 inside a multipart $batch', () => {
  const ROW = {
    ModregId: 'redacted-1', SmShort: 'CHEM-114A', SmObjid: '00002077',
    AcademicYear: '2026', AcademicSession: '002',
  };

  it('finds booked rows in a batched v2 part', () => {
    const out = classifyCapture(batchBody([JSON.stringify({ d: { results: [ROW] } })]));
    expect(out.isV2Doc).toBe(true);
    expect(out.bookedRows).toHaveLength(1);
    expect(out.bookedRows[0]).toMatchObject({ SmShort: 'CHEM-114A' });
  });

  it('merges rows across several v2 parts of one batch', () => {
    const body = batchBody([
      JSON.stringify({ d: { results: [ROW] } }),
      JSON.stringify({ d: { results: [{ ...ROW, ModregId: 'redacted-2', SmShort: 'CSE-008A' }] } }),
    ]);
    expect(classifyCapture(body).bookedRows.map((r) => r.SmShort)).toEqual(['CHEM-114A', 'CSE-008A']);
  });

  it('reports a batched zero-row v2 document as captured, so an empty feed can clear', () => {
    const out = classifyCapture(batchBody([JSON.stringify({ d: { results: [] } })]));
    expect(out.isV2Doc).toBe(true);
    expect(out.bookedRows).toEqual([]);
  });

  it('still reads v4 collections out of the same batch, and mixes the two', () => {
    const v4 = JSON.stringify({
      '@odata.context': '$metadata#Set',
      value: [{ CourseAbbr: 'CSE-008A', ModuleID: '8461', CourseTitle: 'Intro' }],
    });
    const out = classifyCapture(batchBody([v4, JSON.stringify({ d: { results: [ROW] } })]));
    expect(out.moduleRows).toHaveLength(1);
    expect(out.bookedRows).toHaveLength(1);
  });

  it('a batch carrying no v2 part at all is not mistaken for a zero-row feed', () => {
    const v4 = JSON.stringify({ '@odata.context': '$metadata#Set', value: [] });
    expect(classifyCapture(batchBody([v4])).isV2Doc).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { CaptureStore } from './capture-to-courses.js';
import { bookedRowToModule } from '../parser/normalize.js';

const ROW = {
  ModregId: 'redacted-1', SmShort: 'CHEM-114A', SmObjid: '00002077',
  AcademicYear: '2026', AcademicSession: '002',
};
const BODY = JSON.stringify({ d: { results: [ROW] } });
const URL = 'https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/ModuleSet';

describe('bookedRowToModule', () => {
  it('strips zero-padding and builds the same termKey space as course captures', () => {
    expect(bookedRowToModule(ROW)).toEqual({
      courseCode: 'CHEM-114A', moduleId: '2077',
      term: { year: '2026', period: '2', label: 'Fall 2026' },
    });
  });
  it('rejects rows missing identity fields', () => {
    expect(bookedRowToModule({ ...ROW, SmShort: '' })).toBeNull();
  });
});

describe('CaptureStore booked list', () => {
  it('null before any capture; replaced wholesale by an ingest; [] clears', () => {
    const store = new CaptureStore();
    expect(store.getBooked()).toBeNull();
    expect(store.ingestBody(BODY, URL)).toBe(true);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
    // a later homepage load with zero bookings CLEARS (URL identifies the feed)
    expect(store.ingestBody(JSON.stringify({ d: { results: [] } }), URL)).toBe(true);
    expect(store.getBooked()).toEqual([]);
  });
  it('an empty v2 body from some OTHER feed does not touch the booked list', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    store.ingestBody(JSON.stringify({ d: { results: [] } }), 'https://tss.ucsd.edu/sap/opu/odata/ited/OTHER_SRV/Set');
    expect(store.getBooked()).toHaveLength(1);
  });
  it('an XML $metadata body on the booked-feed URL does not clear an existing booked list', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const xml = '<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="1.0"></edmx:Edmx>';
    expect(store.ingestBody(xml, URL)).toBe(false);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
  });
  it('a malformed-JSON body on the booked-feed URL does not clear an existing booked list', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const malformed = '{"d":{"results":[';
    expect(store.ingestBody(malformed, URL)).toBe(false);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
  });
  it('survives serialize/deserialize (and old stores without the field load as null)', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const revived = CaptureStore.deserialize(store.serialize());
    expect(revived.getBooked()).toEqual(store.getBooked());
    expect(CaptureStore.deserialize({}).getBooked()).toBeNull();
  });
});

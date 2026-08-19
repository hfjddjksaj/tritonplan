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

describe('CaptureStore booked freshness', () => {
  it('stamps when TSS reported the list, and keeps it across serialize', () => {
    const store = new CaptureStore();
    expect(store.getBookedAt()).toBeNull();
    store.ingestBody(BODY, URL);
    const at = store.getBookedAt();
    expect(at).not.toBeNull();
    expect(Date.now() - new Date(at!).getTime()).toBeLessThan(5_000);
    expect(CaptureStore.deserialize(store.serialize()).getBookedAt()).toBe(at);
  });

  it('re-stamps on a later report, including one with zero bookings', async () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const first = store.getBookedAt()!;
    await new Promise((r) => setTimeout(r, 2));
    store.ingestBody(JSON.stringify({ d: { results: [] } }), URL);
    expect(new Date(store.getBookedAt()!).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
  });

  it('reads the booked list out of a batched homepage response', () => {
    const store = new CaptureStore();
    const batch =
      '--batch_x\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\n' +
      `Content-Type: application/json\r\n\r\n${BODY}\r\n--batch_x--\r\n`;
    expect(store.ingestBody(batch, 'https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/$batch')).toBe(true);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
  });
});

describe('CaptureStore booked list is not wiped by neighbours', () => {
  it('keeps the list when another v2 payload rides the same service endpoint', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    // Same service, but this response is about something else entirely. Reading v2 out
    // of $batch made bodies like this look like "the feed reported zero" for a while.
    const other = JSON.stringify({ d: { results: [{ Setting: 'x', Value: '1' }] } });
    store.ingestBody(other, 'https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/$batch');
    expect(store.getBooked()).toHaveLength(1);
  });

  it('clears only from the whole-body ModuleSet report — the shape verified live', () => {
    const plain = new CaptureStore();
    plain.ingestBody(BODY, URL);
    plain.ingestBody(JSON.stringify({ d: { results: [] } }), URL);
    expect(plain.getBooked()).toEqual([]);
  });

  it('will not clear from a $batch, however much it looks like the feed', () => {
    // A student's captured bookings went to zero this way. A batch is a bag of other
    // people's responses: we cannot tell which part reported nothing, so a batch that
    // yields no booked rows means "learned nothing here", never "you have none".
    const batched = new CaptureStore();
    batched.ingestBody(BODY, URL);
    const body =
      '--batch_x\r\nContent-Type: application/http\r\n\r\nGET ModuleSet HTTP/1.1\r\n\r\n' +
      'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"d":{"results":[]}}\r\n--batch_x--\r\n';
    batched.ingestBody(body, 'https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/$batch');
    expect(batched.getBooked()).toHaveLength(1);
  });

  it('a batch carrying real rows still replaces the list — batches only ever add', () => {
    const store = new CaptureStore();
    store.ingestBody(JSON.stringify({ d: { results: [] } }), URL); // captured, none
    const body =
      '--batch_x\r\nContent-Type: application/http\r\n\r\n' +
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${BODY}\r\n--batch_x--\r\n`;
    store.ingestBody(body, 'https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/$batch');
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
  });
});

describe('CaptureStore booked list survives the round trip honestly', () => {
  it('does not load an empty stored list — it reads as never captured, not as zero', () => {
    const store = new CaptureStore();
    store.ingestBody(JSON.stringify({ d: { results: [] } }), URL);
    expect(store.getBooked()).toEqual([]);
    // An empty list written before the clear rule was narrowed may be one no student
    // earned, and it cannot be told apart from an honest zero. Ask again instead.
    const revived = CaptureStore.deserialize(store.serialize());
    expect(revived.getBooked()).toBeNull();
    expect(revived.getBookedAt()).toBeNull();
  });

  it('a non-empty list round-trips with its timestamp intact', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const revived = CaptureStore.deserialize(store.serialize());
    expect(revived.getBooked()).toEqual(store.getBooked());
    expect(revived.getBookedAt()).toBe(store.getBookedAt());
  });
});

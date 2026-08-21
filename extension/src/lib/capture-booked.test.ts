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

describe('CaptureStore: the My Courses feed', () => {
  const MY_URL = 'https://tss.ucsd.edu/sap/opu/odata/ITUS/PR_MY_MODULES_V2_SRV/$batch?sap-client=500';
  const myRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    __metadata: { type: 'ITUS.PR_MY_MODULES_V2_SRV.ModuleHeader' },
    SmShort: 'CHEM-114A', SmObjid: '00002077', AcademicYear: '2026', AcademicSession: '002',
    EventPackageAbbr: 'P-002-004', EventPackageId: '00152206', SmStatus: '01',
    SmStatusText: 'Booked', ModregId: 'redacted-1',
    ...over,
  });
  const batched = (rows: unknown[]): string =>
    '--batch_x\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\n' +
    `Content-Type: application/json\r\n\r\n${JSON.stringify({ d: { results: rows } })}\r\n--batch_x--\r\n`;

  it('reports the booking AND the package it was booked on, from one feed', () => {
    const store = new CaptureStore();
    expect(store.ingestBody(batched([myRow()]), MY_URL)).toBe(true);
    expect(store.getBooked()).toEqual([
      { courseCode: 'CHEM-114A', moduleId: '2077', term: { year: '2026', period: '2', label: 'Fall 2026' }, optionCode: 'P-002-004' },
    ]);
    expect(store.getBookedAt()).not.toBeNull();
  });

  it('is not confused with the home feed: same keys, different service', () => {
    // My Courses rows carry ModregId/SmShort/SmObjid too — only __metadata.type tells
    // them apart, which is why rows are attributed rather than shape-guessed.
    const store = new CaptureStore();
    store.ingestBody(batched([myRow()]), MY_URL);
    // A later home-page capture replaces the list but must not lose the packages.
    store.ingestBody(BODY, URL);
    expect(store.getBooked()?.[0]?.optionCode).toBe('P-002-004');
  });

  it('a waitlist booking comes through as one, never as an enrolment', () => {
    // Field values verbatim from the first real waitlisted capture (2026-08-21):
    // CHEM-043A, queued at 2 — see fixtures/my-modules-fall2026.json.
    const store = new CaptureStore();
    const row = myRow({
      SmShort: 'CHEM-043A', SmObjid: '00002117', EventPackageAbbr: 'P-003-004',
      SmStatus: '00', SmStatusText: 'Waitlisted', WaitlistBooking: true, WaitlistPosition: 2,
    });
    expect(store.ingestBody(batched([row]), MY_URL)).toBe(true);
    expect(store.getBooked()).toEqual([
      {
        courseCode: 'CHEM-043A', moduleId: '2117',
        term: { year: '2026', period: '2', label: 'Fall 2026' },
        optionCode: 'P-003-004', waitlisted: true, waitlistPosition: 2,
      },
    ]);
  });

  it('believes the waitlist flag over any code SmStatus happens to carry', () => {
    // Live waitlist rows read SmStatus '00', but the parser still does not go by the
    // code: the statuses nobody has captured are free to collide with it. The fields
    // that SAY waitlist decide, whatever number rides along — here an invented '07'.
    const store = new CaptureStore();
    store.ingestBody(batched([myRow({ SmStatus: '07', SmStatusText: '', WaitlistBooking: true })]), MY_URL);
    expect(store.getBooked()?.[0]?.waitlisted).toBe(true);
  });

  it('reads the words too, for a feed that fills in only the text', () => {
    const store = new CaptureStore();
    store.ingestBody(batched([myRow({ SmStatus: '00', SmStatusText: 'Wait Listed' })]), MY_URL);
    expect(store.getBooked()?.[0]?.waitlisted).toBe(true);
  });

  it('a plain booking says nothing about waitlists', () => {
    const store = new CaptureStore();
    store.ingestBody(batched([myRow()]), MY_URL);
    expect(store.getBooked()?.[0]?.waitlisted).toBeUndefined();
  });

  it('still refuses a status it cannot read at all', () => {
    // A withdrawal is neither an enrolment nor a waitlist, and a green badge on a
    // course the student dropped is worse than no badge.
    const store = new CaptureStore();
    expect(store.ingestBody(batched([myRow({ SmStatus: '03', SmStatusText: 'Withdrawn' })]), MY_URL)).toBe(false);
    expect(store.getBooked()).toBeNull();
  });

  it('no position is better than a made-up one', () => {
    const store = new CaptureStore();
    store.ingestBody(batched([myRow({ WaitlistBooking: true, WaitlistPosition: 0 })]), MY_URL);
    expect(store.getBooked()?.[0]).not.toHaveProperty('waitlistPosition');
  });

  it('survives serialize/deserialize', () => {
    const store = new CaptureStore();
    store.ingestBody(batched([myRow()]), MY_URL);
    expect(CaptureStore.deserialize(store.serialize()).getBooked()).toEqual(store.getBooked());
  });
});

describe('CaptureStore: a home-page capture cannot un-waitlist a student', () => {
  // The home feed lists ENROLMENTS ONLY — verified live 2026-08-21 on a student with 3
  // bookings and 2 queue places: ModuleSet came back with exactly the 3, and the rows
  // carry no status field at all. Reading it as the whole standing is what put the
  // amber badges out: My Courses reported the queues, then the next TSS visit landed on
  // the home page — the page every login opens — and they silently vanished.
  const MY_URL = 'https://tss.ucsd.edu/sap/opu/odata/ITUS/PR_MY_MODULES_V2_SRV/$batch?sap-client=500';
  const myBatch = (rows: unknown[]): string =>
    '--batch_x\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\n' +
    `Content-Type: application/json\r\n\r\n${JSON.stringify({ d: { results: rows } })}\r\n--batch_x--\r\n`;
  const MY_BOOKED = {
    __metadata: { type: 'ITUS.PR_MY_MODULES_V2_SRV.ModuleHeader' },
    SmShort: 'CHEM-114A', SmObjid: '00002077', AcademicYear: '2026', AcademicSession: '002',
    EventPackageAbbr: 'P-002-004', SmStatus: '01', SmStatusText: 'Booked',
    WaitlistBooking: false, WaitlistPosition: 0,
  };
  const MY_QUEUED = {
    __metadata: { type: 'ITUS.PR_MY_MODULES_V2_SRV.ModuleHeader' },
    SmShort: 'CHEM-043A', SmObjid: '00002117', AcademicYear: '2026', AcademicSession: '002',
    EventPackageAbbr: 'P-003-004', SmStatus: '00', SmStatusText: 'Waitlisted',
    WaitlistBooking: true, WaitlistPosition: 2,
  };
  const QUEUE_PLACE = {
    courseCode: 'CHEM-043A', moduleId: '2117',
    term: { year: '2026', period: '2', label: 'Fall 2026' },
    optionCode: 'P-003-004', waitlisted: true, waitlistPosition: 2,
  };
  /** The home feed's own shape: identity fields, no status, queued courses absent. */
  const HOME_BOOKED = {
    ModregId: 'redacted-1', SmShort: 'CHEM-114A', SmObjid: '00002077',
    AcademicYear: '2026', AcademicSession: '002',
  };
  const homeBody = (rows: Record<string, unknown>[]): string => JSON.stringify({ d: { results: rows } });
  /** A student who is enrolled in one course and queued for another. */
  const afterMyCourses = (): CaptureStore => {
    const store = new CaptureStore();
    store.ingestBody(myBatch([MY_BOOKED, MY_QUEUED]), MY_URL);
    return store;
  };

  it('keeps the queue place a feed that only knows enrolments never mentioned', () => {
    const store = afterMyCourses();
    expect(store.ingestBody(homeBody([HOME_BOOKED]), URL)).toBe(true);
    const booked = store.getBooked() ?? [];
    expect(booked.filter((m) => !m.waitlisted).map((m) => m.courseCode)).toEqual(['CHEM-114A']);
    expect(booked.filter((m) => m.waitlisted)).toEqual([QUEUE_PLACE]);
  });

  it('an empty home report clears the enrolments and still keeps the queue', () => {
    // "I dropped everything" is real news about bookings, and no news at all about
    // queues — that feed cannot see them to report them gone.
    const store = afterMyCourses();
    expect(store.ingestBody(homeBody([]), URL)).toBe(true);
    expect(store.getBooked()).toEqual([QUEUE_PLACE]);
  });

  it('drops the queue place when the same course comes back as an enrolment', () => {
    // Off the waitlist and into the class. One course, one standing — never both.
    const store = afterMyCourses();
    store.ingestBody(
      homeBody([HOME_BOOKED, { ...HOME_BOOKED, SmShort: 'CHEM-043A', SmObjid: '00002117' }]),
      URL,
    );
    const booked = store.getBooked() ?? [];
    expect(booked.map((m) => m.courseCode).sort()).toEqual(['CHEM-043A', 'CHEM-114A']);
    expect(booked.some((m) => m.waitlisted)).toBe(false);
  });

  it('an enrolment in ANOTHER term leaves this term\'s queue place standing', () => {
    // The carry-over is keyed by term as well as module: getting into the Winter
    // offering says nothing about the Fall queue the student is still in.
    const store = afterMyCourses();
    store.ingestBody(
      homeBody([{ ...HOME_BOOKED, SmShort: 'CHEM-043A', SmObjid: '00002117', AcademicSession: '001' }]),
      URL,
    );
    expect(store.getBooked()?.filter((m) => m.waitlisted)).toEqual([QUEUE_PLACE]);
  });

  it('the merged list survives serialize/deserialize', () => {
    const store = afterMyCourses();
    store.ingestBody(homeBody([HOME_BOOKED]), URL);
    expect(CaptureStore.deserialize(store.serialize()).getBooked()).toEqual(store.getBooked());
  });
});

describe('CaptureStore: which SECTION was booked', () => {
  const TT_URL =
    'https://tss.ucsd.edu/sap/opu/odata/ited/EVENT_TIMETABLE_SRV/EventListSet?$filter=(EventDate%20ge%20datetime%272025-01-01T00:00:00%27)';
  const ttRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    __metadata: { type: 'ITED_EVENT_TIMETABLE_SRV.EventList' },
    EventId: '00001078', ModuleId: '00002077', EventDate: '/Date(1790294400000)/',
    EventName: 'CHEM-114A-LE (002-000)', EventIsExam: false,
    ...over,
  });
  const ttBody = (rows: unknown[]): string => JSON.stringify({ d: { results: rows } });

  it('joins the timetable to the booked list: which events, per module', () => {
    // The booked feed names the course; only the timetable names the events. Neither
    // alone can answer "am I planning the section I booked?".
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    store.ingestBody(ttBody([ttRow(), ttRow({ EventId: '00002565' })]), TT_URL);
    expect(store.getBooked()).toEqual([{ ...bookedRowToModule(ROW), eventIds: ['00001078', '00002565'] }]);
  });

  it('joins in either capture order', () => {
    const store = new CaptureStore();
    store.ingestBody(ttBody([ttRow()]), TT_URL);
    store.ingestBody(BODY, URL);
    expect(store.getBooked()?.[0]?.eventIds).toEqual(['00001078']);
  });

  it('collapses the one-row-per-date feed to the distinct events', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    // Same lecture, ten weeks of it.
    const weeks = Array.from({ length: 10 }, (_, i) =>
      ttRow({ EventDate: `/Date(${1790294400000 + i * 604800000})/` }),
    );
    store.ingestBody(ttBody(weeks), TT_URL);
    expect(store.getBooked()?.[0]?.eventIds).toEqual(['00001078']);
  });

  it('leaves exams out — they are their own events, never part of a package', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    store.ingestBody(ttBody([ttRow(), ttRow({ EventId: '00009999', EventIsExam: true })]), TT_URL);
    expect(store.getBooked()?.[0]?.eventIds).toEqual(['00001078']);
  });

  it('leaves eventIds ABSENT for a module the timetable says nothing about', () => {
    // Absent means "we don't know which section", which the planner must not read as
    // "no components" — that would make every course look mis-planned.
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    store.ingestBody(ttBody([ttRow({ ModuleId: '00009999' })]), TT_URL);
    expect(store.getBooked()?.[0]).toEqual(bookedRowToModule(ROW));
  });

  it('ignores rows another service typed as its own', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    store.ingestBody(ttBody([ttRow({ __metadata: { type: 'ITED.SOMETHING_ELSE.Row' } })]), TT_URL);
    expect(store.getBooked()?.[0]?.eventIds).toBeUndefined();
  });

  it('survives serialize/deserialize', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    store.ingestBody(ttBody([ttRow()]), TT_URL);
    const revived = CaptureStore.deserialize(store.serialize());
    expect(revived.getBooked()).toEqual(store.getBooked());
  });
});

describe('CaptureStore booked list: rows it cannot read are not zero bookings', () => {
  const BATCH_URL = 'https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/$batch';
  const batchOf = (json: string): string =>
    '--batch_x\r\nContent-Type: application/http\r\n\r\n' +
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${json}\r\n--batch_x--\r\n`;

  it('ignores identically-shaped rows another service put in the same batch', () => {
    // The homepage batches several services at once and a batch part carries no URL,
    // so shape alone would let a neighbour's rows pass as bookings — and, lacking the
    // term fields, be understood as none. `__metadata.type` is the attribution.
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const at = store.getBookedAt();
    const foreign = {
      __metadata: { type: 'ITED.EVENT_TIMETABLE_SRV.Event' },
      ModregId: 'redacted-9', SmShort: 'CHEM-114A', SmObjid: '00002077',
    };
    expect(store.ingestBody(batchOf(JSON.stringify({ d: { results: [foreign] } })), BATCH_URL)).toBe(false);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
    expect(store.getBookedAt()).toBe(at);
  });

  it('reads rows that name the booked service, wherever they arrive', () => {
    const store = new CaptureStore();
    const typed = { __metadata: { type: 'ITED.BC_OVP_BOOKED_MODULES_SRV.Module' }, ...ROW };
    store.ingestBody(batchOf(JSON.stringify({ d: { results: [typed] } })), BATCH_URL);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
  });

  it('stays silent when the feed answers with rows it cannot understand', () => {
    // Rows short of the term fields (a `$select`ed subset, a changed schema) are a
    // failure to read, not a report of zero. Writing [] here would stamp that failure
    // with a fresh time and the planner would state it as fact.
    const store = new CaptureStore();
    const partial = {
      __metadata: { type: 'ITED.BC_OVP_BOOKED_MODULES_SRV.Module' },
      ModregId: 'redacted-1', SmShort: 'CHEM-114A', SmObjid: '00002077',
    };
    expect(store.ingestBody(JSON.stringify({ d: { results: [partial] } }), URL)).toBe(false);
    expect(store.getBooked()).toBeNull();
    expect(store.getBookedAt()).toBeNull();
  });

  it('keeps an earlier real list when a later report is unreadable', () => {
    const store = new CaptureStore();
    store.ingestBody(BODY, URL);
    const partial = { ModregId: 'redacted-2', SmShort: '', SmObjid: '' };
    store.ingestBody(JSON.stringify({ d: { results: [partial] } }), URL);
    expect(store.getBooked()).toEqual([bookedRowToModule(ROW)]);
  });
});

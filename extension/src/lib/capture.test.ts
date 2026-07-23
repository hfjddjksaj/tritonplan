import { describe, it, expect, vi, afterEach } from 'vitest';
import { CaptureStore } from './capture-to-courses.js';
import { classifyCapture } from './extract-odata.js';
import { loadNormalizedFixture, denormalize } from '../parser/fixtures.js';
import type { TssModuleRow } from '../parser/tss-types.js';

const fx = loadNormalizedFixture();

function odataBody(value: unknown[]): string {
  return JSON.stringify({ '@odata.context': '$metadata#Whatever', value });
}

const cse008Meta: TssModuleRow = {
  AcademicYear: '2026',
  AcademicPeriod: '2',
  ModuleID: '8461',
  AcademicLevel: 'Lower Division',
  DepartmentAbbr: 'CSE',
  DepartmentText: 'Computer Science and Engineering',
  CourseAbbr: 'CSE-008A',
  CourseTitle: 'Introduction to Programming and Computational Problem Solving - 1',
  CreditsDisplay: '4.00',
};

describe('capture pipeline', () => {
  it('builds a full CourseOffering from a module-list + sections capture', () => {
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    store.ingestBody(odataBody(denormalize(fx['CSE-008A']!)));
    const courses = store.toCourses();
    expect(courses).toHaveLength(1);
    expect(courses[0]!.courseCode).toBe('CSE-008A');
    expect(courses[0]!.title).toContain('Introduction to Programming');
    expect(courses[0]!.units).toBe(4);
    expect(courses[0]!.department).toBe('Computer Science and Engineering');
    expect(courses[0]!.options).toHaveLength(9);
  });

  it('falls back to EventPkgText for course code when no module meta was captured', () => {
    const store = new CaptureStore();
    store.ingestBody(odataBody(denormalize(fx['CSE-030']!)));
    const courses = store.toCourses();
    expect(courses).toHaveLength(1);
    expect(courses[0]!.courseCode).toBe('CSE-030');
    expect(courses[0]!.title).toBe('CSE-030'); // fallback
  });

  it('extracts embedded collections from a multipart $batch body', () => {
    const inner = odataBody([cse008Meta]);
    const batch =
      '--batch_id\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      inner +
      '\r\n--batch_id--\r\n';
    const { moduleRows } = classifyCapture(batch);
    expect(moduleRows).toHaveLength(1);
    expect(moduleRows[0]!.CourseAbbr).toBe('CSE-008A');
  });

  it('merges a paged continuation ($skip>0) instead of replacing page 1', () => {
    const rows = denormalize(fx['CSE-008A']!);
    const page1 = rows.slice(0, 5);
    const page2 = rows.slice(5);
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    store.ingestBody(odataBody(page1), 'https://tss.ucsd.edu/odata/.../_sections?$skip=0&$top=5');
    store.ingestBody(odataBody(page2), `https://tss.ucsd.edu/odata/.../_sections?$skip=5&$top=${page2.length}`);
    expect(store.toCourses()[0]!.options).toHaveLength(9);
  });

  it('replaces held section rows on a fresh (unpaged) re-browse', () => {
    const rows = denormalize(fx['CSE-008A']!);
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    store.ingestBody(odataBody(rows));
    // Fresh browse returns only part of the data (e.g. filtered) — it should win outright.
    const firstPkg = rows.filter((r) => r.EventPkgOtjid === rows[0]!.EventPkgOtjid);
    store.ingestBody(odataBody(firstPkg), 'https://tss.ucsd.edu/odata/.../_sections?$skip=0&$top=30');
    expect(store.toCourses()[0]!.options).toHaveLength(1);
  });

  it('survives round-trip serialize/deserialize (for chrome.storage)', () => {
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    store.ingestBody(odataBody(denormalize(fx['CSE-008A']!)));
    const restored = CaptureStore.deserialize(JSON.parse(JSON.stringify(store.serialize())));
    expect(restored.toCourses()[0]!.options).toHaveLength(9);
  });
});

describe('capturedAt (seat-count freshness)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps section captures and re-stamps on a fresh re-browse', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T10:00:00Z'));
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    store.ingestBody(odataBody(denormalize(fx['CSE-008A']!)));
    expect(store.toCourses()[0]!.capturedAt).toBe('2026-07-24T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-07-24T12:30:00Z'));
    store.ingestBody(odataBody(denormalize(fx['CSE-008A']!)));
    expect(store.toCourses()[0]!.capturedAt).toBe('2026-07-24T12:30:00.000Z');
  });

  it('a module-list-only capture does not stamp (no seat data arrived)', () => {
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    expect(store.toCourses()).toHaveLength(0); // no sections, no course either
  });

  it('round-trips through serialize/deserialize; old stores without it stay undefined', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T10:00:00Z'));
    const store = new CaptureStore();
    store.ingestBody(odataBody([cse008Meta]));
    store.ingestBody(odataBody(denormalize(fx['CSE-008A']!)));
    const restored = CaptureStore.deserialize(JSON.parse(JSON.stringify(store.serialize())));
    expect(restored.toCourses()[0]!.capturedAt).toBe('2026-07-24T10:00:00.000Z');

    const legacy = store.serialize();
    delete legacy.capturedAt;
    const old = CaptureStore.deserialize(JSON.parse(JSON.stringify(legacy)));
    expect(old.toCourses()[0]!.capturedAt).toBeUndefined();
  });
});

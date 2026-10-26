import type { ApptTimes, CourseOffering } from './types.js';

// Wire contract of POST /api/sync and GET /api/state, shared by server and web. Types only (plus one const): no runtime deps.

export type SyncOp =
  | { op: 'putTerm'; termKey: string; baseVersion: number; data: unknown }
  | { op: 'deleteTerm'; termKey: string; baseVersion: number }
  | { op: 'putPlan'; planId: string; termKey: string; baseVersion: number; data: unknown }
  | { op: 'deletePlan'; planId: string; baseVersion: number }
  | { op: 'putCourses'; courses: CourseOffering[] }
  | { op: 'deleteCourses'; ids: string[] }
  | { op: 'putAppt'; data: ApptTimes[] };
export interface SyncVersions { terms: Record<string, number>; plans: Record<string, number> }
export type SyncResponse =
  | { ok: true; versions: SyncVersions }
  | { ok: false; error: 'conflict'; conflicts: { kind: 'term' | 'plan'; id: string }[] };
export interface StateSnapshot<T = unknown, P = unknown> {
  terms: Record<string, { version: number; data: T }>;
  plans: Record<string, { version: number; termKey: string; data: P }>;
  pool: CourseOffering[];
  appt: ApptTimes[] | null;
}
export const SYNC_LIMITS = { maxOps: 500, maxBodyBytes: 8_000_000, maxDocBytes: 1_000_000 } as const;

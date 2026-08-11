/**
 * Regression: the LIVE `_sections` feed returns EventPkgLimit / EventPkgSeatsAvailable /
 * StatusSemantic as JSON NUMBERS (verified against tss.ucsd.edu 2026-08-10, CHEM-43A
 * module 2117 — a fully-booked course, 0 seats in all 21 packages), while the older
 * fixtures in docs/tss-recon model them as strings. `toNum` must accept both, and a
 * numeric 0 must survive to the planner shape — `seatsAvailable: 0` is what drives the
 * "0/23 waitlist" row and the Full badge, so losing it hides fullness entirely.
 * Rows below are captured live, verbatim.
 */
import { describe, expect, it } from 'vitest';
import { CaptureStore } from './capture-to-courses.js';

const LIVE_ROWS = [
  {"AcYear":"2026","AcPeriod":"2","ModuleID":"2117","EventPkgOtjid":"SE00152262","EventID":"E 00001073","TeachingMethod":"LE","TeachingMethod_Text":"Lecture","InstructorName":"Joshua Figueroa","InstructorEmail":"mailto: J1FIGUEROA@UCSD.EDU","locationText":"UC San Diego","Status":"Scheduled","StatusSemantic":0,"EventAbbr":"001-000-LE","Sched":"F 09:00 AM - 09:50 AM In Person @ York Hall Room 2622\nMidterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person @ York Hall Room 2622\nFinal Examination 12/05/2026 11:30 AM - 02:29 PM In Person @ York Hall Room 2622","EventPkgObjid":"152262","EventPkgDisplayID":"SE00152262","EventPkgText":"CHEM-043A (P-001-001)","EventPkgLimit":23,"EventPkgSeatsAvailable":0,"EventPkgNumOnWaitl":0,"EventPkgSemanticColorCapacity":1,"EventPkgDisable":"X","EventPkgStatusText":"Waitlist Only"},
  {"AcYear":"2026","AcPeriod":"2","ModuleID":"2117","EventPkgOtjid":"SE00152262","EventID":"E 00002670","TeachingMethod":"LA","TeachingMethod_Text":"Laboratory","InstructorName":"Joshua Figueroa","InstructorEmail":"mailto: J1FIGUEROA@UCSD.EDU","locationText":"UC San Diego","Status":"Waitlist Only","StatusSemantic":2,"EventAbbr":"001-001-LA","Sched":"M, W 09:00 AM - 11:50 AM In Person @ York Hall Room 3108","EventPkgObjid":"152262","EventPkgDisplayID":"SE00152262","EventPkgText":"CHEM-043A (P-001-001)","EventPkgLimit":23,"EventPkgSeatsAvailable":0,"EventPkgNumOnWaitl":0,"EventPkgSemanticColorCapacity":1,"EventPkgDisable":"X","EventPkgStatusText":"Waitlist Only"},
  {"AcYear":"2026","AcPeriod":"2","ModuleID":"2117","EventPkgOtjid":"SE00152262","EventID":"EL00002334","TeachingMethod":"OT","TeachingMethod_Text":"Other","InstructorName":"Joshua Figueroa","InstructorEmail":"mailto: J1FIGUEROA@UCSD.EDU","locationText":"UC San Diego","Status":"Scheduled","StatusSemantic":0,"EventAbbr":"001-001-OT","Sched":"Schedule Not Defined","EventPkgObjid":"152262","EventPkgDisplayID":"SE00152262","EventPkgText":"CHEM-043A (P-001-001)","EventPkgLimit":23,"EventPkgSeatsAvailable":0,"EventPkgNumOnWaitl":0,"EventPkgSemanticColorCapacity":1,"EventPkgDisable":"X","EventPkgStatusText":"Waitlist Only"},
];

const LIVE_CONTEXT =
  '../$metadata#YUCSD_CON_EVENTS(AcPeriod,AcYear,EventAbbr,EventID,EventPkgDisable,EventPkgDisplayID,EventPkgLimit,EventPkgNumOnWaitl,EventPkgObjid,EventPkgOtjid,EventPkgSeatsAvailable,EventPkgSemanticColorCapacity,EventPkgStatusText,EventPkgText,InstructorEmail,InstructorName,ModuleID,Sched,Status,StatusSemantic,TeachingMethod,TeachingMethod_Text,locationText)';

describe('live CHEM-43A capture (numeric seat fields, 0 seats)', () => {
  it('keeps seatsAvailable = 0 through the full pipeline', () => {
    const body = JSON.stringify({ '@odata.context': LIVE_CONTEXT, value: LIVE_ROWS });
    const store = new CaptureStore();
    const changed = store.ingestBody(
      body,
      "https://tss.ucsd.edu/sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001/YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='2117')/_sections?sap-client=500&$skip=0&$top=1000",
    );
    expect(changed).toBe(true);
    const courses = store.toCourses();
    expect(courses).toHaveLength(1);
    const course = courses[0]!;
    expect(course.courseCode).toBe('CHEM-043A');
    expect(course.options).toHaveLength(1);
    const opt = course.options[0]!;
    expect(opt.seatsAvailable).toBe(0);
    expect(opt.limit).toBe(23);
    expect(opt.waitlist).toBe(0);
    expect(opt.status).toBe('Waitlist Only');
  });
});

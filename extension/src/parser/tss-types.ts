/**
 * Raw TSS (SAP SLcM) OData shapes the parser consumes. Grounded in real captured
 * responses — see docs/tss-recon/tss-api-notes.md.
 */

/** One row of the `_sections` navigation response: a (Event × EventPackage) pair (DENORMALIZED). */
/** One row of YUCSD_I_PREREQ_TREE — a flat tree of enrollment requirements.
 *  Roots (`parent_id: ""`) are AND-ed groups; children are OR alternatives.
 *  The owning module is NOT in the rows — it's in the collection's @odata.context. */
export interface TssPrereqRow {
  id: string;
  parent_id: string;
  text: string;
}

export interface TssSectionRow {
  AcYear: string;
  AcPeriod: string;
  ModuleID: string;
  // Event (teaching component)
  EventID: string;
  EventKey?: string;
  EventAbbr: string;              // "001-000-LE"
  TeachingMethod: string;        // "LE"
  TeachingMethod_Text: string;   // "Lecture"
  InstructorName?: string;
  InstructorEmail?: string;      // "mailto: LEPORTER@UCSD.EDU"
  LocationText?: string;         // "UC San Diego" | "MC Online"
  Status?: string;
  Limit?: string;
  BeginDate?: string;            // ISO
  EndDate?: string;
  Sched: string;                 // the pre-formatted schedule string ⭐
  // EventPackage (bookable option)
  EventPkgOtjid: string;         // "SE00154302"
  EventPkgDisplayID?: string;
  EventPkgText?: string;         // "CSE-008A (P-001-001)"
  EventPkgLimit?: string;
  EventPkgSeatsAvailable?: string;
  EventPkgNumOnWaitl?: number;
  EventPkgStatusText?: string;
}

/** One row of the course-search list (`YUCSD_CON_MODULE`). */
export interface TssModuleRow {
  AcademicYear: string;
  AcademicPeriod: string;
  ModuleID: string;
  AcademicLevel?: string;
  DepartmentAbbr?: string;
  DepartmentText?: string;
  CourseAbbr: string;            // "CSE-008A"
  CourseTitle: string;
  CreditsDisplay?: string;
  incrementDisplay?: string;
}

/** One row of ysd_appttimes `appointmentTimes` — an enrollment window. */
export interface TssApptTimeRow {
  timelimit: string;             // "9625"
  timelimit_Text: string;        // "First Pass"
  beginTimestamp: string;        // UTC ISO, e.g. "2026-08-10T21:00:00Z" (authoritative)
  endTimestamp: string;
  waitlists?: string;            // "Allowed" | "Not Allowed"
  academicYear?: string;         // "2026"
  academicYear_Text?: string;    // "2026/2027"
  academicSession?: string;      // "2"
  academicSession_Text?: string; // "Fall Quarter"
}

/** One row of ysd_appttimes `maxUnits` — unit cap by (session, window type). */
export interface TssApptMaxUnitsRow {
  Perid: string;     // academicSession code, e.g. "2"
  Timelimit: string; // e.g. "9625"
  MaxUnits: string;  // "11.50"
}

/** The single per-student `apptPeriods` row. The wire row ALSO carries PII
 *  (studentNumber, studentObjid, studyObjid, programObjid) — deliberately NOT
 *  declared here so no code path can read it; normalize whitelists fields. */
export interface TssApptPeriodsRow {
  academicYear: string;
  academicSession: string;
  appointmentTimes?: TssApptTimeRow[];
  maxUnits?: TssApptMaxUnitsRow[];
}

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

/**
 * Which fields a row carries depends on the requesting page's `$select` — e.g. the
 * 2026-08-10 live feed has `locationText` (lowercase) but no `EventKey` / `BeginDate` /
 * `EndDate` / `LocationText`, while the 2026-07-21 fixtures are the other way around.
 * Numeric-looking fields arrive as JSON NUMBERS in the live feed (2026-08-10) but as
 * strings in older captures — declare both and normalize with `toNum`.
 */
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
  LocationText?: string;         // "UC San Diego" | "MC Online" (2026-07-21 captures)
  locationText?: string;         // same content, lowercase key (2026-08-10 feed)
  Status?: string;               // "Scheduled" | "Waitlist Only" | …
  StatusSemantic?: number;       // 0 = Scheduled, 2 = Waitlist Only (observed 2026-08-10)
  Limit?: string | number;
  BeginDate?: string;            // ISO
  EndDate?: string;
  Sched: string;                 // the pre-formatted schedule string ⭐
  // EventPackage (bookable option)
  EventPkgOtjid: string;         // "SE00154302"
  EventPkgObjid?: string;        // "154302" — Otjid without the SE prefix
  EventPkgDisplayID?: string;
  EventPkgText?: string;         // "CSE-008A (P-001-001)"
  EventPkgLimit?: string | number;
  EventPkgSeatsAvailable?: string | number;
  EventPkgNumOnWaitl?: number;
  EventPkgStatusText?: string;   // "" when simply full; "Waitlist Only" when waitlist-gated
  EventPkgSemanticColorCapacity?: number; // 1 observed on fully-booked packages
  EventPkgDisable?: string;      // "X" | "" — TSS greys its booking button on "X"
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

/** One row of the homepage "Booked Courses" feed —
 *  GET /sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/ModuleSet.
 *  ⚠ OData **v2**: the body is `{"d":{"results":[...]}}`, not an
 *  `@odata.context` collection. Verified live 2026-08-11. */
export interface TssBookedModuleRow {
  ModregId: string;            // booking-record GUID (entity key) — personal
  SmShort: string;             // course code, e.g. "CHEM-114A"
  SmStext?: string;            // course title
  SmObjid: string;             // ZERO-PADDED module objid: "00002077" → ModuleID "2077"
  AcademicYear: string;        // "2026"
  AcademicSession: string;     // ZERO-PADDED session: "002" → period "2"
  AcademicSessionText?: string;
  AcademicYearText?: string;
  Credits?: string;
  CreditUnit?: string;
  ConditionalBooking?: boolean; // semantics unverified — do not interpret
}

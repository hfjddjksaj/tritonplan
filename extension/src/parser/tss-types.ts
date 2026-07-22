/**
 * Raw TSS (SAP SLcM) OData shapes the parser consumes. Grounded in real captured
 * responses — see docs/tss-recon/tss-api-notes.md.
 */

/** One row of the `_sections` navigation response: a (Event × EventPackage) pair (DENORMALIZED). */
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

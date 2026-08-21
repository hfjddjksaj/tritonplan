/**
 * Normalized data model — the contract between the extension (which scrapes TSS)
 * and the planner website (which visualizes). The extension parses SAP/TSS OData
 * into these types; the website consumes only these types.
 *
 * Design notes are grounded in real captured TSS data — see docs/tss-recon/.
 */

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** SAP teaching-method code. LE=Lecture, DI=Discussion, LA=Laboratory, SE=Seminar, ST=Studio, IN=Independent, FI=Final, OT=Other. */
export type TeachingMethod =
  | 'LE' | 'DI' | 'LA' | 'SE' | 'ST' | 'IN' | 'FI' | 'OT' | (string & {});

/** A term/quarter. period: SAP AcademicPeriod ("2"=Fall at UCSD in captured data). */
export interface Term {
  year: string;   // AcademicYear, e.g. "2026"
  period: string; // AcademicPeriod, e.g. "2"
  label: string;  // human label, e.g. "Fall 2026"
}

/** One weekly meeting block parsed from a component's `Sched` string. */
export interface Meeting {
  days: Weekday[];       // e.g. ["Tue","Thu"]
  start: string;         // "HH:MM" 24h, e.g. "11:00"
  end: string;           // "HH:MM" 24h, e.g. "12:20"
  modality: string;      // "In Person" | "Live Online" | ...
  building?: string;     // e.g. "Galbraith Hall" (may be truncated in source — kept as-is)
  room?: string;         // e.g. "242"
  location?: string;     // full raw location text after "@", if any
}

/** A final examination, parsed from the lecture component's `Sched`. */
export interface FinalExam {
  date: string;          // ISO "YYYY-MM-DD"
  start: string;         // "HH:MM" 24h
  end: string;           // "HH:MM" 24h
  modality?: string;
  /** Exam location — TSS appends "@ <Location>" to exam lines (seen 2026-08-11).
   *  Absent on older captures, where the raw tail sits inside `modality` instead
   *  (split it with exam-location.ts helpers at display time). */
  location?: string;
  building?: string;
  room?: string;
}

/** A midterm examination — same `Sched` line shape as a final
 *  ("Midterm Examination 10/31/2026 10:00 AM - 11:50 AM In Person"). */
export type MidtermExam = FinalExam;

/** One teaching component (a lecture/discussion/lab) = a TSS Event. */
export interface Component {
  id: string;                 // TSS EventID, e.g. "E 00000958"
  type: TeachingMethod;       // "LE"
  typeText: string;           // "Lecture"
  sectionCode: string;        // TSS EventAbbr, e.g. "001-000-LE"
  instructors: string[];      // ["Leo Porter"]
  instructorEmails?: string[];
  meetings: Meeting[];        // parsed from Sched; empty when unscheduled
  unscheduled: boolean;       // true when Sched === "Schedule Not Defined" (TBA/async)
  beginDate?: string;         // ISO term-component start
  endDate?: string;
  rawSched: string;           // original Sched string, for debugging/round-trip
}

/** A bookable option = a TSS EventPackage (lecture + its discussion/lab combination). */
export interface SectionOption {
  id: string;                 // TSS EventPkgOtjid, e.g. "SE00154302"
  code: string;               // short label, e.g. "P-001-001" (from EventPkgText)
  enrollCode: string;         // EventPkgDisplayID, e.g. "SE00154302"
  limit?: number;
  seatsAvailable?: number;
  waitlist?: number;
  status?: string;
  components: Component[];     // events in this package (deduped)
  final?: FinalExam;          // derived from the lecture component(s)
  /** Midterms with known times. `undefined` = derive from the components'
   *  rawSched (see `optionMidterms`); set explicitly by v3 share decode,
   *  whose components carry no rawSched. */
  midterms?: MidtermExam[];
}

/**
 * One enrollment-requirement group from TSS's YUCSD_I_PREREQ_TREE. Groups are
 * AND-ed together; the options within a group are OR alternatives. All text is
 * display-ready as TSS words it (e.g. "CHEM-007L - General Chemistry Laboratory
 * with a 'D' or higher").
 */
export interface PrereqGroup {
  /** Group heading, e.g. "1 of the following:". */
  label: string;
  /** OR alternatives under this group (may be empty for a childless node). */
  options: string[];
}

/** One enrollment window from TSS "My Appointment Times" ("First Pass",
 *  "Second Pass", …). Window count is variable — real captures showed TWO
 *  Second Pass rows; never assume exactly first+second. */
export interface ApptWindow {
  label: string;      // timelimit_Text verbatim, e.g. "First Pass"
  beginsAt: string;   // UTC ISO instant, e.g. "2026-08-10T21:00:00Z"
  endsAt: string;     // UTC ISO instant (inclusive end)
  unitCap?: string;   // joined from the maxUnits table, e.g. "11.50"
  waitlists?: string; // "Allowed" | "Not Allowed" (verbatim)
}

/** The student's appointment times for one (academic year, session). PERSONAL
 *  data: kept only in the extension's store and the planner's own localStorage —
 *  never inside plans, share links, QR codes or exports. */
export interface ApptTimes {
  academicYear: string;    // "2026"
  academicSession: string; // "2" — same code space as Term.period
  yearText: string;        // "2026/2027"
  sessionText: string;     // "Fall Quarter"
  windows: ApptWindow[];   // sorted by beginsAt ascending
  capturedAt: string;      // ISO timestamp of the capture
}

/** A course offering for a term = a TSS module (YUCSD_CON_MODULE). */
export interface CourseOffering {
  id: string;                 // stable id, e.g. `${courseCode}|${term.year}|${term.period}`
  moduleId: string;           // TSS ModuleID, e.g. "8461"
  subject: string;            // "CSE"
  number: string;             // "008A"
  courseCode: string;         // "CSE-008A"
  title: string;              // "Introduction to Programming ..."
  term: Term;
  units?: number;
  academicLevel?: string;     // "Lower Division" | "Graduate" | ...
  department?: string;        // "Computer Science and Engineering"
  options: SectionOption[];   // bookable packages
  /** ISO timestamp of the capture this data (incl. seat counts) came from — i.e. when
   *  the student last browsed this course in TSS. Absent on data from older builds. */
  capturedAt?: string;
  /** Enrollment requirements captured from TSS. `[]` = confirmed none;
   *  `undefined` = not captured (older builds / course not browsed since). */
  prereqs?: PrereqGroup[];
}

/** What the user has added to their plan and which option they picked per course. */
export interface PlanEntry {
  course: CourseOffering;
  selectedOptionId: string | null; // null = no option chosen yet (course parked)
  color?: string;                   // assigned display color
}

export interface PlanState {
  version: 1;
  term: Term;
  entries: PlanEntry[];
}

/** Message envelope the extension posts into the planner page (data bridge). */
export interface BridgeMessage {
  source: 'triton-planner-extension';
  type: 'courses';
  version: 1;
  payload: CourseOffering[];
}

/** One booked (enrolled) module from the TSS homepage "Booked Courses" feed.
 *  PERSONAL data — bridge payload only, never inside plans or shares. */
export interface BookedModule {
  courseCode: string; // SmShort, e.g. "CHEM-114A"
  moduleId: string;   // SmObjid with leading zeros stripped, e.g. "2077"
  term: Term;
  /**
   * TSS EventIDs of the components the student is actually enrolled in, verbatim as
   * TSS writes them there: `["00001078", "00002565"]`. `Component.id` is the same
   * event with a type prefix ("E 00001078"), so the two match on their digits — which
   * is what makes "is my plan on the section I booked?" answerable.
   *
   * NOT from the booked feed: that one is module-level and names no section at all.
   * These come from the student's own timetable (`EVENT_TIMETABLE_SRV/EventListSet`),
   * which the TSS home page loads alongside it. Absent when that feed hasn't been
   * captured, so treat "no eventIds" as "unknown", never as "no components".
   */
  eventIds?: string[];
  /**
   * The package the student actually booked, as TSS abbreviates it — "P-002-004",
   * the same string as `SectionOption.code`. From the "My Courses" page, the one feed
   * that states it outright; absent when only the home page's feeds were captured, in
   * which case `eventIds` is the way to work it out.
   */
  optionCode?: string;
  /**
   * The student is on this course's WAITLIST, not enrolled in it. Absent means
   * enrolled — or that the feed we read could not tell: the home page's booked
   * feed carries no status field at all, so only a "My Courses" capture can ever
   * set this. Absent is therefore "no reason to think otherwise", never a denial.
   *
   * WHICH PLACE in the queue is deliberately not modelled, though the feed states one
   * (`WaitlistPosition`, seen live as 2 and 11): the number moves as other students
   * drop, TSS's own My Courses page never prints it — so nothing on screen could ever
   * contradict a wrong one — and the fact a student acts on is "not in yet".
   */
  waitlisted?: boolean;
}

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
}

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

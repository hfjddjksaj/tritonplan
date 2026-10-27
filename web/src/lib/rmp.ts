import type { CourseOffering } from '@triton/shared';

export interface CourseInstructor {
  name: string;
  /** Option codes (P-001-001…) this teacher appears in, deduped, in option order. */
  sections: string[];
}

/** TSS fills the slot with a placeholder when nobody is assigned; there is no one to look up. */
const PLACEHOLDERS = new Set(['staff', 'tba']);

/**
 * Everyone TSS names on any component of any option, once each. Case-insensitive on the
 * trimmed name, first spelling kept. The name is passed on exactly as TSS wrote it:
 * reordering or abbreviating it would turn a precise lookup into a guess.
 */
export function courseInstructors(course: CourseOffering): CourseInstructor[] {
  const byKey = new Map<string, CourseInstructor>();
  for (const option of course.options) {
    for (const component of option.components) {
      for (const raw of component.instructors) {
        const name = raw.trim();
        const key = name.toLowerCase();
        if (!name || PLACEHOLDERS.has(key)) continue;
        let who = byKey.get(key);
        if (!who) byKey.set(key, (who = { name, sections: [] }));
        if (!who.sections.includes(option.code)) who.sections.push(option.code);
      }
    }
  }
  return [...byKey.values()];
}

/** RMP's own search, scoped to UCSD (school 1079): where we send people when no single safe match exists. */
export function rmpSearchUrl(name: string): string {
  return `https://www.ratemyprofessors.com/search/professors/1079?q=${encodeURIComponent(name)}`;
}

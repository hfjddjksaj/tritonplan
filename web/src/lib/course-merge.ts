/**
 * Folding a freshly captured course onto the copy we already hold.
 *
 * The extension can only build a complete course when the page fetched the
 * module row alongside the section rows. A browse that saw sections only falls
 * back to `{courseCode, title: courseCode}` with no units, level or department
 * (see `metaFor` in the extension's capture-to-courses). Replacing the stored
 * course wholesale lets that partial capture erase a complete one — which is
 * exactly how a course in someone's plan silently lost its units and showed its
 * course code where its title used to be.
 *
 * So: sections, seats and freshness always come from the fresh copy — that is
 * what a refresh is for — while module-level facts survive a capture that
 * simply never saw them.
 */
import type { CourseOffering } from '@triton/shared';

/** A course built without its module row: the title is just the course code. */
function moduleRowMissing(course: CourseOffering): boolean {
  return course.title === course.courseCode;
}

export function foldCourse(prev: CourseOffering, fresh: CourseOffering): CourseOffering {
  return {
    ...fresh,
    ...(moduleRowMissing(fresh) && !moduleRowMissing(prev) ? { title: prev.title } : {}),
    ...(fresh.units === undefined && prev.units !== undefined ? { units: prev.units } : {}),
    ...(fresh.academicLevel === undefined && prev.academicLevel !== undefined
      ? { academicLevel: prev.academicLevel }
      : {}),
    ...(fresh.department === undefined && prev.department !== undefined
      ? { department: prev.department }
      : {}),
    // `undefined` prereqs means "never captured", `[]` means "TSS lists none" —
    // a capture that didn't look must not overwrite one that did.
    ...(fresh.prereqs === undefined && prev.prereqs !== undefined
      ? { prereqs: prev.prereqs }
      : {}),
    ...(fresh.capturedAt === undefined && prev.capturedAt !== undefined
      ? { capturedAt: prev.capturedAt }
      : {}),
  };
}

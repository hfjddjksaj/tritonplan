import { useMemo, useState } from 'react';
import type { BookedModule, Term } from '@triton/shared';
import { findOption } from '../lib/plan';
import { bookedElsewhere } from '../lib/booked-section';
import { pluralize, relativeTime } from '../lib/format';
import { TSS_HOME_URL, tssBookingLink } from '../lib/tss';
import { displayTermLabel } from '../lib/terms';
import type { PlanController } from '../hooks/usePlan';
import { CHROME_STORE_URL, GITHUB_URL, PRODUCT_NAME } from '../lib/brand';
import { useIsMobile } from '../hooks/useIsMobile';
import { CourseCard } from './CourseCard';
import { Search, Plus, Cap, X, External } from './icons';
import { tip } from './Tooltip';

interface Props {
  ctl: PlanController;
  /** Calendar-block click: reveal this course's card with its sections expanded. */
  focus?: { courseId: string; nonce: number } | null;
  /** Mobile: pane hidden but kept mounted so filter/scroll state survives tab switches. */
  hidden?: boolean;
}

export function CoursePanel({ ctl, focus, hidden = false }: Props) {
  const [filter, setFilter] = useState('');
  const isMobile = useIsMobile();
  const readOnly = ctl.readOnly;
  const entries = ctl.viewPlan.entries;

  const browsed = useMemo(() => {
    const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return ctl.browsedNotAdded;
    return ctl.browsedNotAdded.filter((c) => {
      const hay = `${c.courseCode} ${c.subject} ${c.number} ${c.title}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
  }, [filter, ctl.browsedNotAdded]);

  const hasEntries = entries.length > 0;
  // Only worth offering where it can work: an editable plan, on a machine whose
  // extension has actually spoken to us. Phones can't run it at all.
  const canCheckBookings = !readOnly && !isMobile && ctl.extensionSeen;

  return (
    <aside className={`rail${hidden ? ' rail--hidden' : ''}`}>
      <div className="rail__head">
        <div className="rail__title-row">
          <span className="rail__title">
            {readOnly ? 'Courses in this plan' : 'Added Courses'}
          </span>
          {/* The right-hand slot carries the check when there is one to carry: booked
              status has no other entry point, while the count is also in the top bar.
              Read-only plans and phones (no extension, so nothing to check) keep it. */}
          {canCheckBookings ? (
            <button
              type="button"
              className="btn btn--sm rail__check"
              onClick={ctl.checkBookings}
              {...tip(
                bookedTitle(
                  ctl.bookedSynced,
                  ctl.bookedIds,
                  ctl.bookedAt,
                  ctl.bookedRows,
                  ctl.viewPlan.term,
                ),
              )}
            >
              <External size={13} /> Check bookings
            </button>
          ) : (
            <span className="rail__count mono">
              {ctl.shared ? `${entries.length} ${pluralize(entries.length, 'course')}` : `${entries.length} added`}
              <span className="rail__units"> · {ctl.units} units</span>
            </span>
          )}
        </div>
        <p className="rail__lede">
          {ctl.shared
            ? 'Anyone with the link can switch a section below — everyone who has this plan open sees the change.'
            : readOnly
              ? 'This plan is read-only — a past term kept as an archive.'
              : isMobile
                ? 'Your plans follow your account, so they’re the same here as on your computer. New courses come in from TSS on a computer; switch a section below to clear a conflict.'
                : 'Sections you pick in TSS land here. Switch a section below to clear a conflict.'}
        </p>
      </div>

      <div className="rail__scroll">
        {hasEntries ? (
          entries.map((entry, i) => {
            const option = findOption(entry.course, entry.selectedOptionId);
            const bookable = option && tssBookingLink(entry.course, option) !== null;
            // Warn only, and only when TSS names one specific other package —
            // whether it has the student enrolled on it or queued for it. Switching
            // a section stays a click the student makes themselves.
            const elsewhere = bookedElsewhere(
              entry.course,
              entry.selectedOptionId,
              ctl.enrolledEventIds.get(entry.course.id),
              ctl.bookedOptionCodes.get(entry.course.id),
            );
            return (
              <CourseCard
                key={entry.course.id}
                entry={entry}
                index={i}
                conflicted={ctl.conflictedCourseIds.has(entry.course.id)}
                readOnly={readOnly}
                shared={ctl.shared}
                focusNonce={focus && focus.courseId === entry.course.id ? focus.nonce : undefined}
                onSelect={readOnly && !ctl.shared ? () => {} : (optionId) => ctl.selectOption(entry.course.id, optionId)}
                onRemove={() => ctl.removeCourse(entry.course.id)}
                onOpenTss={() => ctl.openCourseInTss(entry.course)}
                onBook={
                  // Booking is done from the student's own plan, never from a shared one.
                  bookable && !ctl.shared ? () => ctl.openBookingInTss(entry.course, option) : undefined
                }
                booked={ctl.bookedIds.has(entry.course.id)}
                waitlisted={ctl.waitlistedIds.has(entry.course.id)}
                bookedByTss={ctl.tssBookedIds.has(entry.course.id)}
                {...(elsewhere ? { bookedOptionCode: elsewhere.code } : {})}
                onToggleBooked={readOnly ? undefined : () => ctl.toggleBooked(entry.course)}
              />
            );
          })
        ) : (
          <div className="rail__empty">
            <Cap size={30} className="empty__mark" strokeWidth={1.4} />
            <p style={{ marginTop: 10 }}>
              {ctl.shared
                ? 'No courses in this plan.'
                : 'Nothing planned yet. Bring a course over from your browsed list below, or add a section straight from TSS.'}
            </p>
          </div>
        )}

        {/* Browsed — not yet added (yours; hidden while read-only) */}
        {!readOnly && (
        <>
        <div className="rail__section">
          <span className="eyebrow">Browsed — not yet added</span>
          {ctl.browsedNotAdded.length > 0 && !ctl.guest && (
            <button
              type="button"
              className="rail__section-action"
              onClick={() => {
                if (window.confirm('Remove all browsed courses that aren’t in your plan?')) {
                  ctl.clearBrowsed();
                }
              }}
              {...tip('Remove all browsed courses that aren’t in your plan')}
            >
              Clear all
            </button>
          )}
        </div>

        {ctl.browsedNotAdded.length === 0 ? (
          <div className="browse-empty">
            <Search size={22} className="empty__mark" strokeWidth={1.5} />
            {isMobile ? (
              // No extension on phones — say so instead of a store link that can't help here.
              <p>
                Courses you open in TSS on a computer show up here too — your courses and plans
                follow your account. The {PRODUCT_NAME} extension runs in a desktop browser
                only, so a phone can’t bring in new ones.
              </p>
            ) : ctl.extensionSeen ? (
              // The extension is here and simply has nothing yet: send them to TSS, not to the store.
              <>
                <p>
                  Courses you open in TSS show up here — then bring the ones you want into your
                  plan.
                </p>
                <a
                  className="btn btn--primary browse-empty__cta"
                  href={TSS_HOME_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Go to TSS
                </a>
              </>
            ) : (
              <>
                <p>
                  Courses you open in TSS show up here once the {PRODUCT_NAME} extension is
                  installed — then bring the ones you want into your plan.
                </p>
                <a
                  className="btn btn--primary browse-empty__cta"
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get the extension
                </a>
                <span className="browse-empty__hint">Free · Chrome &amp; Edge · read-only</span>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="search search--sm">
              <span className="search__icon" aria-hidden>
                <Search size={14} />
              </span>
              <input
                className="search__input search__input--sm"
                type="search"
                placeholder="Filter browsed courses…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter browsed courses"
              />
            </div>

            {browsed.length === 0 ? (
              <div className="browse-none">No browsed courses match “{filter.trim()}”.</div>
            ) : (
              <ul className="browse-list">
                {browsed.map((c) => (
                  <li key={c.id} className="browse-item">
                    <button
                      type="button"
                      className="browse-row"
                      onClick={() => ctl.addCourse(c)}
                      {...tip(`Bring ${c.courseCode} into your plan`)}
                    >
                      <span className="browse-row__main">
                        <span className="browse-row__code mono">{c.courseCode}</span>
                        <span className="browse-row__title">{c.title}</span>
                      </span>
                      <span className="browse-row__add">
                        <Plus size={13} strokeWidth={2.4} /> {PRODUCT_NAME}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="browse-item__remove"
                      onClick={() => ctl.removeFromPool(c.id)}
                      aria-label={`Remove ${c.courseCode} from browsed courses`}
                      {...tip(`Remove ${c.courseCode} from browsed courses`)}
                    >
                      <X size={13} strokeWidth={2.2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        </>
        )}

        <div className="rail__foot">
          open source at{' '}
          <a
            className="rail__foot-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/hfjddjksaj/tritonplan
          </a>
        </div>
      </div>
    </aside>
  );
}

/**
 * What the check button says on hover — the booked state itself, since it no longer
 * has a line of its own.
 *
 * TSS names your enrolments in exactly one place, the Booked Courses card on its home
 * page, and hands the list over only as that page loads. Neither "open in TSS" nor
 * "book section" goes near it: both deep-link straight into another Fiori app
 * (verified live 2026-08-18). So this button exists, and so does this explanation.
 *
 * Counts what the plan shows (bookedIds), never what the feed said (rows) — those
 * are two different numbers, and conflating them makes this line say "TSS reports
 * no bookings at all" while TSS is reporting all three of a student's courses:
 * each one unmarked by hand, the feed blamed for the student's own edit. The feed
 * overrules an unmark (see applyAutoBooked), so the two can only differ for a
 * course TSS never mentioned.
 *
 * The other case is "read, but none for this term". The badges key off the term on
 * screen, so bookings TSS reports for a DIFFERENT term look identical to no bookings
 * at all — name the term they are in instead of reporting a flat zero. Terms are
 * matched on year+period, never on the label, which is display text.
 *
 * Only a report received THIS session is spoken for. `synced` is remembered on this
 * device, and a device can outlive the capture it remembers — saying "TSS reports no
 * bookings" on the strength of a memory is how this told a student something false.
 */
export function bookedTitle(
  synced: boolean,
  bookedIds: ReadonlySet<string>,
  at: string | null,
  rows: readonly BookedModule[],
  viewedTerm: Term,
): string {
  const how =
    "TSS states what you're enrolled in only on pages you load yourself — opening a " +
    'course from here never passes it along. This opens My Courses, which reports both ' +
    'your enrolled courses and the section each one is on.';
  const count = bookedIds.size;
  if (!synced) return `Enrolled courses not read yet. ${how}`;
  if (at === null) {
    return count > 0
      ? `${count} enrolled in ${displayTermLabel(viewedTerm)}, from an earlier read. ${how}`
      : `Nothing read from TSS this session. ${how}`;
  }

  const read = `, read ${relativeTime(at)}`;
  const isHere = (r: BookedModule): boolean =>
    r.term.year === viewedTerm.year && r.term.period === viewedTerm.period;
  // A queue place is not a booking, and must not be counted as one — nor denied.
  // "TSS reports no bookings at all" printed beside two Waitlisted badges is the
  // same class of lie.
  const enrolled = rows.filter((r) => !r.waitlisted);
  const queuedHere = rows.filter((r) => r.waitlisted && isHere(r)).length;
  const alsoQueued = queuedHere > 0 ? `, plus ${queuedHere} waitlisted` : '';
  if (count > 0) return `${count} enrolled in ${displayTermLabel(viewedTerm)}${alsoQueued}${read}. ${how}`;
  if (queuedHere > 0) {
    return (
      `Not enrolled in anything in ${displayTermLabel(viewedTerm)} — ${queuedHere} waitlisted${read}. ` +
      `A place in a queue is not an enrolment. ${how}`
    );
  }

  const elsewhere = [...new Set(enrolled.filter((r) => !isHere(r)).map((r) => displayTermLabel(r.term)))];
  if (elsewhere.length > 0) {
    return (
      `TSS reports ${enrolled.length} enrolled, but in ${elsewhere.join(' and ')} — none in ` +
      `${displayTermLabel(viewedTerm)}, the term on screen${read}. ${how}`
    );
  }
  return `TSS reports no enrolled courses at all${read}. ${how}`;
}


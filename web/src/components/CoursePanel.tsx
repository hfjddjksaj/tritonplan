import { useMemo, useState } from 'react';
import type { CourseOffering } from '@triton/shared';
import { findOption, type UnscheduledItem } from '../lib/plan';
import { tssBookingLink } from '../lib/tss';
import type { PlanController } from '../hooks/usePlan';
import { PRODUCT_NAME } from '../lib/brand';
import { CourseCard } from './CourseCard';
import { UnscheduledList } from './UnscheduledList';
import { Search, Plus, Cap, X } from './icons';

interface Props {
  ctl: PlanController;
  unscheduled: UnscheduledItem[];
}

function matches(course: CourseOffering, q: string): boolean {
  const hay = `${course.courseCode} ${course.subject} ${course.number} ${course.title}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

export function CoursePanel({ ctl, unscheduled }: Props) {
  const [filter, setFilter] = useState('');

  const browsed = useMemo(() => {
    const q = filter.trim();
    if (!q) return ctl.browsedNotAdded;
    return ctl.browsedNotAdded.filter((c) => matches(c, q));
  }, [filter, ctl.browsedNotAdded]);

  const hasEntries = ctl.plan.entries.length > 0;

  return (
    <aside className="rail">
      <div className="rail__head">
        <div className="rail__title-row">
          <span className="rail__title">Browsed &amp; Added Courses</span>
          <span className="rail__count mono">{ctl.plan.entries.length} added</span>
        </div>
        <p className="rail__lede">
          Sections you pick in TSS land here. Switch a section below to clear a conflict.
        </p>
      </div>

      <div className="rail__scroll">
        {hasEntries ? (
          ctl.plan.entries.map((entry, i) => {
            const option = findOption(entry.course, entry.selectedOptionId);
            const bookable = option && tssBookingLink(entry.course, option) !== null;
            return (
              <CourseCard
                key={entry.course.id}
                entry={entry}
                index={i}
                conflicted={ctl.conflictedCourseIds.has(entry.course.id)}
                onSelect={(optionId) => ctl.selectOption(entry.course.id, optionId)}
                onRemove={() => ctl.removeCourse(entry.course.id)}
                onOpenTss={() => ctl.openCourseInTss(entry.course)}
                onBook={
                  bookable ? () => ctl.openBookingInTss(entry.course, option) : undefined
                }
              />
            );
          })
        ) : (
          <div className="rail__empty">
            <Cap size={30} className="empty__mark" strokeWidth={1.4} />
            <p style={{ marginTop: 10 }}>
              Nothing planned yet. Bring a course over from your browsed list below, or add a
              section straight from TSS.
            </p>
          </div>
        )}

        {/* Browsed — not yet added */}
        <div className="rail__section">
          <span className="eyebrow">Browsed — not yet added</span>
          {ctl.browsedNotAdded.length > 0 && (
            <button
              type="button"
              className="rail__section-action"
              onClick={() => {
                if (window.confirm('Remove all browsed courses that aren’t in your plan?')) {
                  ctl.clearBrowsed();
                }
              }}
              title="Remove all browsed courses that aren’t in your plan"
            >
              Clear all
            </button>
          )}
        </div>

        {ctl.browsedNotAdded.length === 0 ? (
          <div className="browse-empty">
            <Search size={22} className="empty__mark" strokeWidth={1.5} />
            <p>
              Courses you open in TSS show up here once the {PRODUCT_NAME} extension is installed —
              then bring the ones you want into your plan.
            </p>
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
                      title={`Bring ${c.courseCode} into your plan`}
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
                      title={`Remove ${c.courseCode} from browsed courses`}
                    >
                      <X size={13} strokeWidth={2.2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <UnscheduledList items={unscheduled} />
      </div>
    </aside>
  );
}

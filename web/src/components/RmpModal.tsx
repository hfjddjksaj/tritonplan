/** Several teachers on one course: ratings side by side, each row a link to RMP.
 *  Portaled like PlanPickerModal — the course rail is overflow:hidden. Laid out like
 *  the Share dialog; whoever teaches the section on the plan stands out, so a
 *  student sees their own professor at a glance. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RmpLookup } from '@triton/shared';
import { lookupRmp } from '../lib/cloud/api';
import { pluralize } from '../lib/format';
import { rmpSearchUrl, type CourseInstructor } from '../lib/rmp';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { Star, X } from './icons';

interface Props {
  courseCode: string;
  instructors: CourseInstructor[];
  /** Code of the section chosen on the plan ("P-002-001"), if any. */
  selectedCode?: string | null;
  onClose: () => void;
}

/** "A", "A and B", "A, B and C". */
function names(list: string[]): string {
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function RmpModal({ courseCode, instructors, selectedCode = null, onClose }: Props) {
  useEscapeKey(onClose);
  const [loading, setLoading] = useState(true);
  const [found, setFound] = useState<RmpLookup[] | null>(null);

  useEffect(() => {
    let live = true;
    void lookupRmp(instructors.map((i) => i.name)).then((r) => {
      if (!live) return;
      setFound(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [instructors]);

  const mine = selectedCode ? instructors.filter((who) => who.sections.includes(selectedCode)) : [];

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop planpick rmp"
        role="dialog"
        aria-modal="true"
        aria-label={`Rate My Professors — ${courseCode}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <div className="eyebrow">Rate My Professors</div>
        <div className="mappop__name">{courseCode}</div>
        <p className="planpick__sub">
          {mine.length > 0
            ? `Your section, ${selectedCode}, is taught by ${names(mine.map((who) => who.name))}.`
            : 'Pick a professor to open their page.'}
        </p>
        <div className="planpick__list">
          {instructors.map((who, i) => {
            const hit = found?.[i];
            const m = hit?.match ?? null;
            const rated = m !== null && m.numRatings > 0 && m.avgRating !== null;
            const isMine = mine.includes(who);
            // Before the answer arrives (or when it never does) a row still works: RMP's own search.
            const url = m?.url ?? hit?.searchUrl ?? rmpSearchUrl(who.name);
            return (
              <button
                key={who.name}
                type="button"
                className={`planpick__item rmp__row${isMine ? ' rmp__row--mine' : ''}`}
                onClick={() => window.open(url, '_blank', 'noopener')}
              >
                <span className="rmp__who">
                  <span className="rmp__name">
                    {who.name}
                    {isMine && <span className="rmp__tag">Your section</span>}
                  </span>
                  <span className="rmp__sections">
                    {who.sections.map((code) => (
                      <span key={code} className={`rmp__sec mono${code === selectedCode ? ' rmp__sec--mine' : ''}`}>
                        {code}
                      </span>
                    ))}
                  </span>
                </span>
                {/* No answer (the lookup failed) says nothing: "no ratings" would claim a zero we don't know. */}
                {hit && (
                  <span className="rmp__score">
                    {rated ? (
                      <>
                        <span className="rmp__avg">
                          <Star size={14} className="rmp__star" />
                          <span className="mono">{m.avgRating!.toFixed(1)}</span>
                        </span>
                        <span className="rmp__count">
                          {m.numRatings} {pluralize(m.numRatings, 'rating')}
                        </span>
                      </>
                    ) : (
                      <span className="rmp__count">no ratings</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mappop__hint rmp__note">
          {loading ? 'Loading ratings…' : 'Ratings from RateMyProfessors.com, updated monthly.'}
        </p>
      </div>
    </div>,
    document.body,
  );
}

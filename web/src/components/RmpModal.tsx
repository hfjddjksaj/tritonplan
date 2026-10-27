/** Several teachers on one course: ratings side by side, each row a link to RMP.
 *  Portaled like PlanPickerModal — the course rail is overflow:hidden. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RmpLookup } from '@triton/shared';
import { lookupRmp } from '../lib/cloud/api';
import { rmpSearchUrl, type CourseInstructor } from '../lib/rmp';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
  courseCode: string;
  instructors: CourseInstructor[];
  onClose: () => void;
}

export function RmpModal({ courseCode, instructors, onClose }: Props) {
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

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop planpick rmp"
        role="dialog"
        aria-modal="true"
        aria-label={`Rate My Professors — ${courseCode}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">Rate My Professors — {courseCode}</h2>
        {loading && <p className="planpick__sub">Loading ratings…</p>}
        <div className="planpick__list">
          {instructors.map((who, i) => {
            const hit = found?.[i];
            const m = hit?.match ?? null;
            const rated = m !== null && m.numRatings > 0 && m.avgRating !== null;
            // Before the answer arrives (or when it never does) a row still works: RMP's own search.
            const url = m?.url ?? hit?.searchUrl ?? rmpSearchUrl(who.name);
            return (
              <button
                key={who.name}
                type="button"
                className="planpick__item rmp__row"
                onClick={() => window.open(url, '_blank', 'noopener')}
              >
                <span className="rmp__who">
                  <span className="planpick__name">{who.name}</span>
                  <span className="planpick__count">Sections {who.sections.join(', ')}</span>
                </span>
                {!loading && (
                  <span className="rmp__score">
                    {rated ? (
                      <>
                        <span className="rmp__avg">★ {m.avgRating!.toFixed(1)}</span>
                        <span className="planpick__count">{m.numRatings} ratings</span>
                      </>
                    ) : (
                      <span className="planpick__count">no ratings</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="planpick__sub rmp__note">Ratings from RateMyProfessors.com, updated monthly.</p>
        <button type="button" className="btn btn--sm planpick__cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

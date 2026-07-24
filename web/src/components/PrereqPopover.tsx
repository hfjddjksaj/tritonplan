import { Fragment, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CourseOffering } from '@triton/shared';
import { X } from './icons';

interface Props {
  course: CourseOffering;
  /** The card's theme colors, forwarded because the portal leaves the card's DOM. */
  accent?: { text: string; spine: string };
  onClose: () => void;
}

/**
 * Enrollment requirements as TSS lists them — groups are AND-ed, the options
 * inside a group are OR alternatives. Rendered from passively captured data;
 * nothing is fetched here. Portaled to <body> so no card/rail ancestor can
 * clip or re-anchor the fixed backdrop.
 */
export function PrereqPopover({ course, accent, onClose }: Props) {
  const groups = course.prereqs ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop prereqpop"
        role="dialog"
        aria-modal="true"
        aria-label={`${course.courseCode} enrollment requirements`}
        style={
          accent && {
            ['--c-text' as string]: accent.text,
            ['--c-spine' as string]: accent.spine,
          }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Enrollment requirements</div>
        <div className="prereqpop__course">{course.courseCode}</div>
        <div className="prereqpop__groups">
          {groups.map((g, i) => (
            <Fragment key={`${g.label}-${i}`}>
              {i > 0 && <div className="prereqpop__and">and</div>}
              <div className="prereqpop__group">
                <div className="prereqpop__label">{g.label}</div>
                {g.options.length > 0 && (
                  <ul className="prereqpop__opts">
                    {g.options.map((opt) => (
                      <li key={opt}>{opt}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Fragment>
          ))}
        </div>
        <p className="mappop__hint">
          As listed in TSS when this course was last browsed. Check the course in TSS for the
          authoritative version.
        </p>
      </div>
    </div>,
    document.body,
  );
}

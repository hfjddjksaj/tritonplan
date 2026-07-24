import { Fragment } from 'react';
import { createPortal } from 'react-dom';
import type { CourseOffering } from '@triton/shared';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { PRODUCT_NAME } from '../lib/brand';
import { External, X } from './icons';

interface Props {
  course: CourseOffering;
  /** The card's theme colors, forwarded because the portal leaves the card's DOM. */
  accent?: { text: string; spine: string };
  /** Fallback when nothing was captured yet: jump to the course in TSS. */
  onOpenTss: () => void;
  onClose: () => void;
}

/**
 * Enrollment requirements as TSS lists them — groups are AND-ed, the options
 * inside a group are OR alternatives. Rendered from passively captured data;
 * nothing is fetched here. Three states: captured groups, captured-empty
 * (TSS confirmed none), and not-captured-yet (offer the TSS jump instead).
 * Portaled to <body> so no card/rail ancestor can clip the fixed backdrop.
 */
export function PrereqPopover({ course, accent, onOpenTss, onClose }: Props) {
  const groups = course.prereqs;

  useEscapeKey(onClose);

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

        {groups === undefined ? (
          <>
            <p className="prereqpop__none">
              Not captured yet. Open this course in TSS once — with the {PRODUCT_NAME} extension
              installed, its requirements are picked up automatically and will show here.
            </p>
            <div className="mappop__actions">
              <button type="button" className="btn btn--sm btn--primary" onClick={onOpenTss}>
                <External size={14} /> Open in TSS
              </button>
            </div>
          </>
        ) : groups.length === 0 ? (
          <p className="prereqpop__none">
            None — TSS lists no enrollment requirements for this course.
          </p>
        ) : (
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
        )}

        <p className="mappop__hint">
          {groups === undefined
            ? 'Once captured, they’ll show right here.'
            : 'As listed in TSS when this course was last browsed. Check the course in TSS for the authoritative version.'}
        </p>
      </div>
    </div>,
    document.body,
  );
}

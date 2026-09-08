import { createPortal } from 'react-dom';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { X } from './icons';

interface Props {
  courseCode: string;
  /** Package TSS says the student booked, e.g. "P-002-004". */
  booked: string;
  /** The student is QUEUED for that package, not enrolled on it. Same disagreement,
   *  one state earlier — so the same two rows, in the waitlist's words and colour. */
  queued?: boolean;
  /** Package the plan currently shows, when it is known. */
  selected?: string | undefined;
  /** The card's theme colors, forwarded because the portal leaves the card's DOM. */
  accent?: { text: string; spine: string };
  /** Reveal the card's section list — the student still picks. */
  onShowSections: () => void;
  onClose: () => void;
}

/**
 * "TSS has you on a different section than this plan shows."
 *
 * The alert on the card is one character wide, so the explanation lives here rather
 * than in a tooltip only a mouse can find. It states the two package codes and stops:
 * switching a section is the student's own click, never ours, so the most this offers
 * is to open the list they would pick from.
 *
 * `queued` swaps the words, not the layout. A place in a queue is not an enrolment —
 * saying "TSS has you in P-003-004" about a waitlist would state as fact the very
 * thing the student is waiting to find out — so the verb changes and the hint stops
 * promising a booking is safe. Everything else is deliberately identical: one
 * disagreement, one shape of answer.
 */
export function BookedSectionPopover({
  courseCode, booked, queued = false, selected, accent, onShowSections, onClose,
}: Props) {
  useEscapeKey(onClose);

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop bookedpop"
        role="dialog"
        aria-modal="true"
        aria-label={`${courseCode} ${queued ? 'waitlisted' : 'booked'} section`}
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
        <div className="eyebrow">{queued ? 'Waitlisted section' : 'Booked section'}</div>
        <div className="bookedpop__course">{courseCode}</div>

        <div className="bookedpop__rows">
          <div className="bookedpop__row">
            <span className="bookedpop__who">{queued ? 'TSS has you queued for' : 'TSS has you in'}</span>
            <span
              className={`bookedpop__code mono bookedpop__code--tss${queued ? ' bookedpop__code--queued' : ''}`}
            >
              {booked}
            </span>
          </div>
          <div className="bookedpop__row">
            <span className="bookedpop__who">This plan shows</span>
            <span className="bookedpop__code mono">{selected ?? 'no section picked'}</span>
          </div>
        </div>

        <div className="mappop__actions">
          <button type="button" className="btn btn--sm btn--primary" onClick={onShowSections}>
            Show sections
          </button>
        </div>

        <p className="mappop__hint">
          {queued ? (
            <>
              Nothing here changes your place in the queue or your plan. If you meant to plan the
              section you are queued for, pick {booked} from the list yourself — and remember a
              queue place is not an enrolment.
            </>
          ) : (
            <>
              Nothing here changes your booking or your plan. If you meant to plan the section you
              booked, pick {booked} from the list yourself.
            </>
          )}
        </p>
      </div>
    </div>,
    document.body,
  );
}

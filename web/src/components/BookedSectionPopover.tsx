import { Dialog } from './Dialog';

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
  return (
    <Dialog
      label={`${courseCode} ${queued ? 'waitlisted' : 'enrolled'} section`}
      className="bookedpop"
      onClose={onClose}
      accent={accent}
      eyebrow={queued ? 'Waitlisted section' : 'Enrolled section'}
      title={courseCode}
    >

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
              Nothing here changes your enrollment or your plan. If you meant to plan the section you
              are enrolled in, pick {booked} from the list yourself.
            </>
          )}
        </p>
    </Dialog>
  );
}

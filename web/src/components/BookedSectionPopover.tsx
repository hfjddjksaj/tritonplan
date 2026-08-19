import { createPortal } from 'react-dom';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { X } from './icons';

interface Props {
  courseCode: string;
  /** Package TSS says the student booked, e.g. "P-002-004". */
  booked: string;
  /** Package the plan currently shows, when it is known. */
  selected?: string | undefined;
  /** The card's theme colors, forwarded because the portal leaves the card's DOM. */
  accent?: { text: string; spine: string };
  /** Reveal the card's section list — the student still picks. */
  onShowSections: () => void;
  onClose: () => void;
}

/**
 * "TSS has you in a different section than this plan shows."
 *
 * The alert on the card is one character wide, so the explanation lives here rather
 * than in a tooltip only a mouse can find. It states the two package codes and stops:
 * switching a section is the student's own click, never ours, so the most this offers
 * is to open the list they would pick from.
 */
export function BookedSectionPopover({
  courseCode, booked, selected, accent, onShowSections, onClose,
}: Props) {
  useEscapeKey(onClose);

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop bookedpop"
        role="dialog"
        aria-modal="true"
        aria-label={`${courseCode} booked section`}
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
        <div className="eyebrow">Booked section</div>
        <div className="bookedpop__course">{courseCode}</div>

        <div className="bookedpop__rows">
          <div className="bookedpop__row">
            <span className="bookedpop__who">TSS has you in</span>
            <span className="bookedpop__code mono bookedpop__code--tss">{booked}</span>
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
          Nothing here changes your booking or your plan. If you meant to plan the section you
          booked, pick {booked} from the list yourself.
        </p>
      </div>
    </div>,
    document.body,
  );
}

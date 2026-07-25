import { createPortal } from 'react-dom';
import { formatDisplay } from '@triton/shared';
import type { PositionedBlock } from '../lib/layout';
import { colorsForHue } from '../lib/colors';
import { weekdayLong } from '../lib/format';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { External, Warning, X } from './icons';

interface Props {
  block: PositionedBlock;
  onOpenCourse: (courseId: string) => void;
  onOpenLocation: (block: PositionedBlock) => void;
  onFocusCourse: (courseId: string) => void;
  onClose: () => void;
}

/**
 * Mobile tap-a-block detail card. Collapses the desktop block's three click
 * targets (code → TSS, location → building map, elsewhere → course card) into
 * one sheet with explicit buttons. Portaled to <body> like PrereqPopover.
 */
export function BlockSheet({ block, onOpenCourse, onOpenLocation, onFocusCourse, onClose }: Props) {
  useEscapeKey(onClose);
  const c = colorsForHue(block.hue);
  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop blocksheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${block.courseCode} ${block.typeText}`}
        style={{ ['--c-spine' as string]: c.spine, ['--c-text' as string]: c.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">{block.typeText}</div>
        <div className="blocksheet__code mono">{block.courseCode}</div>
        <div className="blocksheet__time">
          {weekdayLong(block.day)} · {formatDisplay(block.start)} – {formatDisplay(block.end)}
        </div>
        {block.conflict && (
          <div className="blocksheet__warn">
            <Warning size={14} /> Time conflict with another course
          </div>
        )}
        {block.location &&
          (block.building ? (
            <button type="button" className="blocksheet__loc" onClick={() => onOpenLocation(block)}>
              {block.location}
            </button>
          ) : (
            <div className="blocksheet__loctext">{block.location}</div>
          ))}
        {block.instructor && <div className="blocksheet__instr">{block.instructor}</div>}
        <div className="mappop__actions">
          <button type="button" className="btn btn--sm btn--primary" onClick={() => onOpenCourse(block.courseId)}>
            <External size={13} /> Open in TSS
          </button>
          <button type="button" className="btn btn--sm" onClick={() => onFocusCourse(block.courseId)}>
            Course details
          </button>
        </div>
        <p className="mappop__hint">The location button shows where the building is on campus.</p>
      </div>
    </div>,
    document.body,
  );
}

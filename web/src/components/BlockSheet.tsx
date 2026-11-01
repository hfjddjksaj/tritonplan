import { formatDisplay } from '@triton/shared';
import type { PositionedBlock } from '../lib/layout';
import { colorsForHue } from '../lib/colors';
import { weekdayLong } from '../lib/format';
import { isNamedInstructor } from '../lib/rmp';
import { Dialog } from './Dialog';
import { External, Warning } from './icons';

interface Props {
  block: PositionedBlock;
  onOpenCourse: (courseId: string) => void;
  onOpenLocation: (block: PositionedBlock) => void;
  /** Show the course's Rate My Professors ratings. */
  onOpenInstructor: (block: PositionedBlock) => void;
  onFocusCourse: (courseId: string) => void;
  onClose: () => void;
}

/**
 * Mobile tap-a-block detail card. Collapses the desktop block's click targets
 * (code → TSS, location → building map, teacher → RMP ratings, elsewhere →
 * course card) into one sheet with explicit buttons. Portaled to <body> like PrereqPopover.
 */
export function BlockSheet({ block, onOpenCourse, onOpenLocation, onOpenInstructor, onFocusCourse, onClose }: Props) {
  const c = colorsForHue(block.hue);
  return (
    <Dialog
      label={`${block.courseCode} ${block.typeText}`}
      className="blocksheet"
      onClose={onClose}
      accent={c}
      eyebrow={block.typeText}
    >
        <div className="blocksheet__code mono">{block.courseCode}</div>
        {block.full && <div className="blocksheet__full">No seats left in this section</div>}
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
        {block.instructor &&
          (isNamedInstructor(block.instructor) ? (
            <button type="button" className="blocksheet__instr blocksheet__instr--link" onClick={() => onOpenInstructor(block)}>
              {block.instructor}
            </button>
          ) : (
            <div className="blocksheet__instr">{block.instructor}</div>
          ))}
        <div className="mappop__actions">
          <button type="button" className="btn btn--sm btn--primary" onClick={() => onOpenCourse(block.courseId)}>
            <External size={13} /> Open in TSS
          </button>
          <button type="button" className="btn btn--sm" onClick={() => onFocusCourse(block.courseId)}>
            Course details
          </button>
        </div>
        {block.location && block.building && (
          <p className="mappop__hint">The location button shows where the building is on campus.</p>
        )}
    </Dialog>
  );
}

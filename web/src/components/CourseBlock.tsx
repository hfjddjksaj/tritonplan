import { formatDisplay } from '@triton/shared';
import { colorsForHue } from '../lib/colors';
import type { PositionedBlock } from '../lib/layout';
import { Warning } from './icons';

const GAP = 3; // px between side-by-side lanes

interface Props {
  block: PositionedBlock;
  /** Jump back to this course's TSS schedule view. */
  onOpen: (courseId: string) => void;
  /** Show where this block's building is; when absent the location stays plain text. */
  onOpenLocation?: (block: PositionedBlock) => void;
  /** Reveal this course's card (sections expanded) in the rail; fires on any click
      that isn't the code or the location text. */
  onFocusCourse?: (courseId: string) => void;
}

export function CourseBlock({ block, onOpen, onOpenLocation, onFocusCourse }: Props) {
  const c = colorsForHue(block.hue);
  const widthPct = 100 / block.laneCount;
  const compact = block.height < 42;

  return (
    <article
      className={`block${block.conflict ? ' block--conflict' : ''}${compact ? ' block--sm' : ''}${onFocusCourse ? ' block--focusable' : ''}`}
      onClick={onFocusCourse ? () => onFocusCourse(block.courseId) : undefined}
      style={{
        top: block.top,
        height: Math.max(block.height, 18),
        left: `calc(${block.lane * widthPct}% + ${block.lane === 0 ? 2 : GAP}px)`,
        width: `calc(${widthPct}% - ${block.lane === 0 ? 4 : GAP + 2}px)`,
        // color tokens consumed by .block CSS
        ['--b-spine' as string]: c.spine,
        ['--b-fill' as string]: c.fill,
        ['--b-border' as string]: c.border,
        ['--b-text' as string]: c.text,
      }}
      title={`${block.courseCode} · ${block.typeText}\n${formatDisplay(block.start)} – ${formatDisplay(block.end)}${block.location ? `\n${block.location}` : ''}${block.instructor ? `\n${block.instructor}` : ''}${block.conflict ? '\n⚠ Time conflict' : ''}`}
    >
      {block.conflict && (
        <span className="block__warn" aria-hidden>
          <Warning size={10} strokeWidth={2.6} />
        </span>
      )}
      <div className="block__head">
        {/* Only the code jumps to TSS — the rest of the block stays free for future
            interactions (e.g. clicking the building to show it on a map). */}
        <button
          type="button"
          className="block__code"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(block.courseId);
          }}
          title={`Open ${block.courseCode} in TSS`}
        >
          {block.courseCode}
        </button>
        {!compact && <span className="block__type">{block.typeText}</span>}
      </div>
      <div className="block__time">
        {formatDisplay(block.start)} – {formatDisplay(block.end)}
      </div>
      {!compact &&
        block.location &&
        (block.building && onOpenLocation ? (
          <button
            type="button"
            className="block__loc block__loc--link"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLocation(block);
            }}
            title={`Where is ${block.building}?`}
          >
            {block.location}
          </button>
        ) : (
          <div className="block__loc">{block.location}</div>
        ))}
      {!compact && block.height > 60 && block.instructor && (
        <div className="block__instr">{block.instructor}</div>
      )}
    </article>
  );
}

import { formatDisplay } from '@triton/shared';
import { colorsForHue } from '../lib/colors';
import type { PositionedBlock } from '../lib/layout';
import { Warning } from './icons';

const GAP = 3; // px between side-by-side lanes

interface Props {
  block: PositionedBlock;
  /** Jump back to this course's TSS schedule view. */
  onOpen: (courseId: string) => void;
}

export function CourseBlock({ block, onOpen }: Props) {
  const c = colorsForHue(block.hue);
  const widthPct = 100 / block.laneCount;
  const compact = block.height < 42;

  return (
    <article
      className={`block${block.conflict ? ' block--conflict' : ''}${compact ? ' block--sm' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(block.courseId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(block.courseId);
        }
      }}
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
      title={`${block.courseCode} · ${block.typeText}\n${formatDisplay(block.start)} – ${formatDisplay(block.end)}${block.location ? `\n${block.location}` : ''}${block.instructor ? `\n${block.instructor}` : ''}${block.conflict ? '\n⚠ Time conflict' : ''}\nOpen in TSS`}
    >
      {block.conflict && (
        <span className="block__warn" aria-hidden>
          <Warning size={10} strokeWidth={2.6} />
        </span>
      )}
      <div className="block__head">
        <span className="block__code">{block.courseCode}</span>
        {!compact && <span className="block__type">{block.typeText}</span>}
      </div>
      <div className="block__time">
        {formatDisplay(block.start)} – {formatDisplay(block.end)}
      </div>
      {!compact && block.location && <div className="block__loc">{block.location}</div>}
      {!compact && block.height > 60 && block.instructor && (
        <div className="block__instr">{block.instructor}</div>
      )}
    </article>
  );
}

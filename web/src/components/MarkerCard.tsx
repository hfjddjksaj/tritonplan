import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { colorsForHue } from '../lib/colors';
import { cardDate, cardPlaceName, cardPlacement, cardSections, estimateCardSize, rowText, type Point, type Size } from '../lib/map-card';
import type { PinGroup } from '../lib/map-labels';

interface Props {
  group: PinGroup;
  /** The marker's dot, in canvas px — the card hangs off it and follows it. */
  anchor: Point;
  /** The box the marker's chip holds beside the dot: where the card grows from. */
  chip?: { x: number; y: number; w: number; h: number };
  canvas: Size;
  /** Height of the floating header; the card never climbs under it. */
  insetTop: number;
  /** Absent when the building has no name to look up (never the case for a matched pin). */
  onDirections?: () => void;
}

/**
 * What a clicked marker expands into: the chip's place on the map, grown into
 * a card — the building's name as an eyebrow with Directions beside it, then
 * one section per course (or per exam, dated at the right of the code):
 * code heading, one row per component ("LEC · Room 2622"). Several courses
 * in one building each get a heading of the same size. HTML over the GL
 * canvas (real text, a real button).
 *
 * "Grown into" is literal on two counts. It starts where the chip it replaces
 * was standing (`cardPlacement`), so no chip-shaped hole opens up between the
 * dot and the card, and it scales up out of the corner nearest the dot — the
 * `transform-origin` computed below feeds the one keyframe in app.css. It is
 * also rendered INSIDE its marker (see MapMarkers), which is why the position
 * here is local to the dot rather than in canvas coordinates: the marker's own
 * transform is what keeps card, chip and dot moving as one object under a drag.
 */
export function MarkerCard({ group, anchor, chip, canvas, insetTop, onDirections }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sections = useMemo(() => cardSections(group.pins), [group]);
  const where = group.place ?? group.building ?? 'This building';
  const shownWhere = cardPlaceName(where);
  const [measured, setMeasured] = useState<Size | null>(null);
  // Measure before paint so the first frame is already flipped the right way.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) setMeasured((m) => (m && m.w === w && m.h === h ? m : { w, h }));
  }, [sections]);
  const size = measured ?? estimateCardSize(sections, shownWhere);
  const { left, top } = cardPlacement(anchor, size, canvas, insetTop, chip);
  // The corner nearest the dot, for the grow-out animation: whichever edge the
  // dot is outside of, and the centre when the card straddles it.
  const originX = left >= anchor.x ? 'left' : left + size.w <= anchor.x ? 'right' : 'center';
  const originY = top >= anchor.y ? 'top' : top + size.h <= anchor.y ? 'bottom' : 'center';

  return (
    <div
      ref={ref}
      className="campusmap__card"
      style={{ left: left - anchor.x, top: top - anchor.y, transformOrigin: `${originX} ${originY}` }}
      role="group"
      aria-label={`${where}: classes here`}
    >
      <div className="campusmap__card-head">
        <span className="eyebrow campusmap__card-place" title={where}>
          {shownWhere}
        </span>
        {onDirections && (
          <button
            type="button"
            className="btn btn--sm btn--primary campusmap__card-dir"
            onClick={onDirections}
          >
            Directions
          </button>
        )}
      </div>
      {sections.map((s) => {
        const sc = colorsForHue(s.hue);
        return (
          <section key={`${s.courseId}|${s.date ?? ''}`} className="campusmap__card-section">
            <div className="campusmap__card-code" style={{ color: sc.text }}>
              <span>{s.courseCode}</span>
              {s.date && <span className="campusmap__card-date">{cardDate(s.date)}</span>}
            </div>
            <ul className="campusmap__card-rows">
              {s.rows.map((r) => (
                <li key={`${r.label}|${r.room ?? ''}`} aria-label={rowText(r)}>
                  {r.room ? (
                    <>
                      {r.label} · <span className="campusmap__card-room">Room {r.room}</span>
                    </>
                  ) : (
                    r.label
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

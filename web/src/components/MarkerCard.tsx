import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { colorsForHue } from '../lib/colors';
import { cardPlaceName, cardPlacement, cardSections, estimateCardSize, rowText, type Point, type Size } from '../lib/map-card';
import type { PinGroup } from '../lib/map-labels';

interface Props {
  group: PinGroup;
  /** The marker's dot, in canvas px — the card hangs off it and follows it. */
  anchor: Point;
  canvas: Size;
  /** Height of the floating header; the card never climbs under it. */
  insetTop: number;
  /** Absent when the building has no name to look up (never the case for a matched pin). */
  onDirections?: () => void;
}

/**
 * What a clicked marker expands into: the chip's place on the map, grown into
 * a card — the building's name as an eyebrow with Directions beside it, then
 * one section per course: code heading, one row per component ("LEC · Room
 * 2622"). Several courses in one building each get a heading of the same
 * size. HTML over the GL canvas (real text, a real button), positioned from
 * the marker's projected screen coordinates on every camera change.
 */
export function MarkerCard({ group, anchor, canvas, insetTop, onDirections }: Props) {
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
  const { left, top } = cardPlacement(anchor, size, canvas, insetTop);

  return (
    <div
      ref={ref}
      className="campusmap__card"
      style={{ left, top }}
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
          <section key={s.courseId} className="campusmap__card-section">
            <div className="campusmap__card-code" style={{ color: sc.text }}>
              {s.courseCode}
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

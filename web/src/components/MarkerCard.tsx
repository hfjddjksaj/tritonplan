import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { colorsForHue } from '../lib/colors';
import type { Box } from '../lib/map-basemap';
import { cardPlacement, cardSections, estimateCardSize, rowText, type Size } from '../lib/map-card';
import type { PinGroup } from '../lib/map-labels';
import type { Point } from '../lib/map-projection';

interface Props {
  group: PinGroup;
  /** The marker's dot, in canvas px — the card hangs off it and follows it. */
  anchor: Point;
  canvas: Size;
  /** Height of the floating header; the card never climbs under it. */
  insetTop: number;
  /** Absent when the building has no name to look up (never the case for a matched pin). */
  onDirections?: () => void;
  /** The box the card ended up in, so the canvas keeps basemap names out of it. */
  onBox: (box: Box) => void;
}

/**
 * What a clicked marker expands into: the chip's place on the map, grown into
 * a card — course code top-left, Directions top-right, then one row per
 * component ("LEC · Room 2622"). Several courses in one building each get a
 * heading of the same size. HTML over the SVG (real text, a real button),
 * positioned from the marker's screen coordinates on every view change.
 */
export function MarkerCard({ group, anchor, canvas, insetTop, onDirections, onBox }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sections = useMemo(() => cardSections(group.pins), [group]);
  const [measured, setMeasured] = useState<Size | null>(null);
  // Measure before paint so the first frame is already flipped the right way.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) setMeasured((m) => (m && m.w === w && m.h === h ? m : { w, h }));
  }, [sections]);
  const size = measured ?? estimateCardSize(sections);
  const { left, top } = cardPlacement(anchor, size, canvas, insetTop);
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;
  useLayoutEffect(() => {
    onBoxRef.current({ x: left, y: top, w: size.w, h: size.h });
  }, [left, top, size.w, size.h]);

  const c = colorsForHue(group.pins[0]!.hue);
  const where = group.place ?? group.building ?? 'this building';
  return (
    <div
      ref={ref}
      className="campusmap__card"
      style={{ left, top, borderColor: c.spine }}
      role="group"
      aria-label={`${where}: classes here`}
    >
      {sections.map((s, i) => {
        const sc = colorsForHue(s.hue);
        return (
          <section key={s.courseId} className="campusmap__card-section">
            <div className="campusmap__card-head">
              <span className="campusmap__card-code" style={{ color: sc.text }}>
                {s.courseCode}
              </span>
              {i === 0 && onDirections && (
                <button type="button" className="campusmap__card-dir" onClick={onDirections}>
                  Directions
                </button>
              )}
            </div>
            <ul className="campusmap__card-rows">
              {s.rows.map((r) => (
                <li key={`${r.label}|${r.room ?? ''}`}>{rowText(r)}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

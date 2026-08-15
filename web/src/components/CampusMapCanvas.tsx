import { useMemo } from 'react';
import { campusViewport, type CampusGeo } from '../lib/campus-geo';
import type { MapPin } from '../lib/map-pins';
import { groupPins, onCanvasGroups, placeLabels, type PinGroup } from '../lib/map-labels';
import { project, toScreen, type Point } from '../lib/map-projection';
import { colorsForHue } from '../lib/colors';

interface Props {
  geo: CampusGeo;
  pins: MapPin[];
  width: number;
  height: number;
  /** Group key of the expanded marker, or null. */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

/** Rough chip width per character — good enough for collision avoidance. */
const CHAR_W = 6.2;
const CHIP_H = 16;

function ringPath(ring: number[], toPx: (p: Point) => Point): string {
  let d = '';
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const p = toPx(project(ring[i]!, ring[i + 1]!));
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return d ? `${d}Z` : '';
}

/**
 * The map itself: districts, then building footprints, then one marker per
 * building that has classes in it. Geometry decisions all live in
 * map-projection / map-labels so this file stays a renderer.
 */
export function CampusMapCanvas({ geo, pins, width, height, selectedKey, onSelect }: Props) {
  // Only groups the viewport can actually show: an off-canvas marker would be
  // clipped by the <svg> anyway, and reserving a label box for it would shove
  // visible chips around for nothing. CampusMap lists them instead.
  const groups = useMemo(() => onCanvasGroups(groupPins(pins), geo, width, height), [
    pins,
    geo,
    width,
    height,
  ]);

  const view = useMemo(() => campusViewport(geo, width, height), [geo, width, height]);

  const toPx = useMemo(() => (p: Point) => toScreen(p, view), [view]);

  const markers = useMemo(
    () => groups.map((g) => ({ group: g, pt: toPx(project(g.lng, g.lat)) })),
    [groups, toPx],
  );

  const labels = useMemo(() => {
    const placed = placeLabels(
      markers.map(({ group, pt }) => ({
        key: group.key,
        x: pt.x,
        y: pt.y,
        w: chipText(group.pins).length * CHAR_W + 10,
        h: CHIP_H,
      })),
    );
    return new Map(placed.map((p) => [p.key, p]));
  }, [markers]);

  return (
    <svg
      className="campusmap__svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      // Not role="img": the markers inside are the only route to the detail panel, and
      // a role="img" subtree is presentational to assistive tech — the buttons would be
      // announced as nothing at all.
      role="group"
      aria-label="UCSD campus map of this term's class locations"
      onClick={() => onSelect(null)}
    >
      <g className="campusmap__districts">
        {geo.districts.map((s, i) => (
          <path key={`${s.name}-${i}`} className="campusmap__district" d={s.rings.map((r) => ringPath(r, toPx)).join(' ')} />
        ))}
      </g>
      <g className="campusmap__footprints">
        {geo.footprints.map((s, i) => (
          <path key={`${s.name}-${i}`} className="campusmap__footprint" d={s.rings.map((r) => ringPath(r, toPx)).join(' ')} />
        ))}
      </g>
      <g className="campusmap__markers">
        {markers.map(({ group, pt }) => {
          const c = colorsForHue(group.pins[0]!.hue);
          const booked = group.pins.some((p) => p.booked);
          const label = labels.get(group.key);
          const text = chipText(group.pins);
          return (
            <g
              key={group.key}
              className={`campusmap__marker${booked ? ' campusmap__marker--booked' : ''}${
                selectedKey === group.key ? ' campusmap__marker--open' : ''
              }`}
              // A marker is the only way into the detail panel, so it has to be
              // reachable without a mouse.
              role="button"
              tabIndex={0}
              aria-label={markerLabel(group)}
              aria-pressed={selectedKey === group.key}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(selectedKey === group.key ? null : group.key);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); // Space would scroll the overlay
                e.stopPropagation();
                onSelect(selectedKey === group.key ? null : group.key);
              }}
            >
              <circle
                className="campusmap__dot"
                cx={pt.x}
                cy={pt.y}
                r={6}
                fill={booked ? c.spine : '#fff'}
                stroke={c.spine}
                strokeWidth={2}
              />
              {label && (
                <>
                  <rect
                    className="campusmap__chip"
                    x={label.x}
                    y={label.y}
                    width={text.length * CHAR_W + 10}
                    height={CHIP_H}
                    rx={4}
                    fill={c.fill}
                    stroke={c.border}
                  />
                  <text className="campusmap__chiptext" x={label.x + 5} y={label.y + 11.5} fill={c.text}>
                    {text}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Spoken form of a marker: the chip is an abbreviation, this is the whole truth. */
function markerLabel(g: PinGroup): string {
  const what = g.pins.map((p) => `${p.courseCode} ${p.label}`).join(', ');
  return g.building ? `${g.building}: ${what}` : what;
}

/** "CSE-8A LEC" for one class here, "CSE-8A +2" when several share the building. */
function chipText(pins: MapPin[]): string {
  const first = pins[0]!;
  return pins.length === 1 ? `${first.courseCode} ${first.label}` : `${first.courseCode} +${pins.length - 1}`;
}

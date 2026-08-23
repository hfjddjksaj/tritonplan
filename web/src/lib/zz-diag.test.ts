import { beforeAll, describe, it } from 'vitest';
import wire from '../data/ucsd-walk-graph.json';
import { matchBuilding } from './buildings';
import { type CampusShape, loadCampusGeo } from './campus-geo';
import { type WalkGraphWire, decodeWalkGraph, metresBetween } from './walk-graph';
import { routeBetween } from './walk-route';
import { type Portal, buildPortals, resampleOutline } from './walk-snap';

const g = decodeWalkGraph(wire as WalkGraphWire);

const NAMES = [
  'Mayer Hall',
  'Mayer Hall Addition',
  'York Hall',
  'Peterson Hall',
  'Center Hall',
  'Galbraith Hall',
  'Urey Hall',
  'Solis Hall',
  'Geisel Library',
  'Price Center West',
];

let shapes: Map<string, CampusShape>;
const doors = new Map<string, Portal[]>();
const centro = new Map<string, { lat: number; lon: number }>();
const outlines = new Map<string, [number, number][]>();

function toOutline(name: string): number {
  const hit = matchBuilding(name)!;
  const centroid = { lat: hit.lat, lon: hit.lng };
  centro.set(name, centroid);
  const rings = (hit.parts ?? [hit.name]).flatMap((n) => shapes.get(n)?.rings ?? []);
  const out = rings.length === 0 ? [[centroid.lat, centroid.lon] as [number, number]] : resampleOutline(rings);
  outlines.set(name, out);
  doors.set(name, buildPortals(g, out, centroid));
  // widest radius of the footprint from its centroid
  let far = 0;
  for (const [la, lo] of out) far = Math.max(far, metresBetween(centroid.lat, centroid.lon, la, lo));
  return far;
}

const toOutlineDist = (name: string, lat: number, lon: number): number => {
  let best = Infinity;
  for (const [la, lo] of outlines.get(name)!) best = Math.min(best, metresBetween(lat, lon, la, lo));
  return best;
};

beforeAll(async () => {
  const geo = await loadCampusGeo();
  shapes = new Map();
  for (const f of geo.footprints) if (!shapes.has(f.name)) shapes.set(f.name, f);
  for (const n of NAMES) {
    const far = toOutline(n);
    console.log(`${n}: radius=${far.toFixed(0)}m doors=${doors.get(n)!.length}`);
  }
}, 60_000);

describe('diag', () => {
  it('endpoint sanity vs OUTLINE', () => {
    for (let i = 0; i < NAMES.length; i++) {
      for (let j = i + 1; j < NAMES.length; j++) {
        const a = NAMES[i]!;
        const b = NAMES[j]!;
        const r = routeBetween(g, doors.get(a)!, doors.get(b)!, 'walk');
        if (!r) {
          console.log(`${a} -> ${b}: NO ROUTE`);
          continue;
        }
        const p0 = r.path[0]!;
        const pz = r.path[r.path.length - 1]!;
        const dStart = toOutlineDist(a, p0[1], p0[0]);
        const dEnd = toOutlineDist(b, pz[1], pz[0]);
        const ca = centro.get(a)!;
        const cb = centro.get(b)!;
        const gapA = metresBetween(ca.lat, ca.lon, p0[1], p0[0]);
        const gapB = metresBetween(cb.lat, cb.lon, pz[1], pz[0]);
        const flag = dStart > 45.5 || dEnd > 45.5 ? '  <<<< OVER REACH' : '';
        console.log(
          `${a} -> ${b}: pts=${r.path.length} net=${r.metres.toFixed(0)}m ` +
            `startToOutline=${dStart.toFixed(0)} endToOutline=${dEnd.toFixed(0)} ` +
            `startToPin=${gapA.toFixed(0)} endToPin=${gapB.toFixed(0)}${flag}`,
        );
      }
    }
  }, 120_000);
});

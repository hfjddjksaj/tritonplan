/**
 * The bundled UCSD pedestrian routing graph: decode, and the CSR adjacency the
 * campus map's Distance bar runs its Dijkstra over.
 *
 * Generated at dev time by `npm run fetch:walk-graph -w @triton/web`. The page
 * NEVER fetches it at runtime — it is bundled, and pulled in with a dynamic
 * import, so the ~89 KB (gzip) stays out of every chunk until a reader actually
 * opens the Distance bar.
 *
 * Wire format mirrors campus-geo.ts: quantised onto a 1e6 integer grid (~0.11 m
 * at UCSD's latitude, well under the finest thing the map draws) and
 * delta-encoded, so most values are one or two digits.
 */

/** Raw contents of `ucsd-walk-graph.json`; every field is written by the fetch script. */
export interface WalkGraphWire {
  source: string;
  fetched: string;
  bbox: number[];
  /** Flat `[x0, y0, dx, dy, …]` lon/lat integers at SCALE, delta-encoded. */
  nodes: number[];
  /** Metres above sea level per node, delta-encoded in the same node order. */
  elev: number[];
  /** Flat `[da0, b0, da1, b1, …]`: endpoint `a` delta-encoded (the edges are sorted by it), `b` raw. */
  edges: number[];
  /** Delta-encoded indices into `edges` of the `highway=steps` ones. */
  steps: number[];
}

/**
 * Compressed-sparse-row adjacency. `head[i] … head[i+1]` is the slice of
 * `to`/`len`/`steps` belonging to node `i` — one flat pass instead of 15k
 * little arrays, which is what keeps a full-graph Dijkstra in the low tens of
 * milliseconds.
 *
 * Undirected: each wire edge appears TWICE here, once per direction, so a
 * relaxation only ever reads forward from `head[u]`.
 */
export interface WalkGraph {
  readonly n: number;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  /** Metres above sea level, sampled from the bundled terrarium DEM. */
  readonly elev: Int16Array;
  readonly head: Int32Array;
  readonly to: Int32Array;
  readonly len: Float32Array;
  /** 1 when that adjacency entry is an OSM `highway=steps` edge. */
  readonly steps: Uint8Array;
}

const SCALE = 1e6;
const M_LAT = 111_320;
/** UCSD's latitude; the campus spans ~3 km, so one cosine for the lot is exact enough. */
const M_LON = M_LAT * Math.cos((32.881 * Math.PI) / 180);

export function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return Math.hypot((aLat - bLat) * M_LAT, (aLon - bLon) * M_LON);
}

export function decodeWalkGraph(wire: WalkGraphWire): WalkGraph {
  const n = wire.nodes.length / 2;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += wire.nodes[2 * i]!;
    y += wire.nodes[2 * i + 1]!;
    lon[i] = x / SCALE;
    lat[i] = y / SCALE;
  }

  const elev = new Int16Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    e += wire.elev[i]!;
    elev[i] = e;
  }

  const m = wire.edges.length / 2;
  const ea = new Int32Array(m);
  const eb = new Int32Array(m);
  let a = 0;
  for (let i = 0; i < m; i++) {
    a += wire.edges[2 * i]!;
    ea[i] = a;
    eb[i] = wire.edges[2 * i + 1]!;
  }

  const isSteps = new Uint8Array(m);
  let s = 0;
  for (const d of wire.steps) {
    s += d;
    isSteps[s] = 1;
  }

  // CSR build in three passes: count each node's degree into head[i+1], turn
  // those counts into start offsets with a prefix sum, then fill. Counting one
  // slot to the RIGHT is what makes the prefix sum land on starts rather than
  // ends, and leaves head[0] = 0 and head[n] = 2m for free.
  const head = new Int32Array(n + 1);
  for (let i = 0; i < m; i++) {
    head[ea[i]! + 1] = head[ea[i]! + 1]! + 1;
    head[eb[i]! + 1] = head[eb[i]! + 1]! + 1;
  }
  for (let i = 0; i < n; i++) head[i + 1] = head[i + 1]! + head[i]!;

  // A write cursor per node, consumed as the fill advances; `head` itself must
  // survive intact, so this is a copy of the starts and not an alias of them.
  const cursor = Int32Array.from(head.subarray(0, n));
  const to = new Int32Array(2 * m);
  const len = new Float32Array(2 * m);
  const steps = new Uint8Array(2 * m);
  for (let i = 0; i < m; i++) {
    const u = ea[i]!;
    const v = eb[i]!;
    const d = metresBetween(lat[u]!, lon[u]!, lat[v]!, lon[v]!);
    let k = cursor[u]!++;
    to[k] = v;
    len[k] = d;
    steps[k] = isSteps[i]!;
    k = cursor[v]!++;
    to[k] = u;
    len[k] = d;
    steps[k] = isSteps[i]!;
  }

  return { n, lat, lon, elev, head, to, len, steps };
}

let cached: Promise<WalkGraph> | null = null;

/**
 * Load and decode the graph, once per session. Dynamic import so the bytes
 * never enter the first-paint chunk — nothing downloads until the Distance bar
 * is first expanded (spec §7.6: opening the map itself stays 0 ms slower).
 */
export function loadWalkGraph(): Promise<WalkGraph> {
  cached ??= import('../data/ucsd-walk-graph.json').then((m) =>
    decodeWalkGraph((m.default ?? m) as unknown as WalkGraphWire),
  );
  return cached;
}

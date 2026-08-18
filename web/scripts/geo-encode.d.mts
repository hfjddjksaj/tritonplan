/**
 * Ambient types for geo-encode.mjs, the plain-JS helper module the fetch
 * scripts share (see that file's own header). This declaration exists only
 * so `campus-geo.test.ts` can import it under `strict`/`noImplicitAny` — the
 * fetch scripts themselves are plain Node ESM and stay untyped.
 */

/** A raw lon/lat (or x/y) pair — not a strict 2-tuple, so plain `number[][]` ring literals still typecheck. */
export type Point2D = number[];
/** A shape as the fetch scripts build it before encoding: named rings of raw lon/lat pairs. */
export interface RawShape {
  name: string;
  rings: Point2D[][];
}

export declare const M_PER_DEG_LAT: number;
export declare const M_PER_DEG_LON: number;
export declare const GEO_SCALE: number;

export declare function perpDist(p: Point2D, a: Point2D, b: Point2D): number;
export declare function rdp(pts: Point2D[], eps: number): Point2D[];

export declare function encodeRing(ring: Point2D[], epsM?: number): number[];
export declare function encodeShape(shape: RawShape, epsM?: number): [string, number[][]];
export declare function vertexCount(shapes: readonly [unknown, number[][], ...unknown[]][]): number;

export declare function pointInRing(x: number, y: number, ring: Point2D[]): boolean;
export declare function centroid(ring: Point2D[]): Point2D;
export declare function centroidInsideAny(ring: Point2D[], shapes: readonly RawShape[]): boolean;

export declare function queryAll(
  layerUrl: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]>;

// @vitest-environment node
// (Same reason as map-fonts.test.ts: this file touches the filesystem, and under
// the workspace's jsdom environment `import.meta.url` comes back rewritten
// through Vite's module graph rather than as a real file: URL.)
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TERRAIN_BOUNDS, TERRAIN_MINZOOM, TERRAIN_MAXZOOM } from './map-style';

const tile = (z: number, x: number, y: number) =>
  fileURLToPath(new URL(`../../public/map/terrain/${z}/${x}/${y}.png`, import.meta.url));

/** Web Mercator tile indices — the formula `scripts/fetch-terrain.mjs` fetches by. */
const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

/**
 * The DEM the style promises MapLibre has to actually be on disk. The style
 * declares `bounds` and a zoom range; MapLibre then asks for every tile inside
 * that box, and a gap is not a graceful degradation — it is a 404 storm and a
 * hole in the hillshade. The style's constants and the fetch script's are
 * separate declarations of the same thing, so this is where they are held
 * together.
 */
describe('bundled terrain tiles', () => {
  it('cover the whole box the style declares, at every zoom it declares', () => {
    const [west, south, east, north] = TERRAIN_BOUNDS;
    const missing: string[] = [];
    let count = 0;
    for (let z = TERRAIN_MINZOOM; z <= TERRAIN_MAXZOOM; z++) {
      for (let x = lonToX(west, z); x <= lonToX(east, z); x++) {
        for (let y = latToY(north, z); y <= latToY(south, z); y++) {
          count++;
          if (!existsSync(tile(z, x, y))) missing.push(`${z}/${x}/${y}`);
        }
      }
    }
    expect(count).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it('are real PNGs, not error pages saved with a .png name', () => {
    // The campus centre (Geisel, 32.881 / -117.234) at both zooms: the tiles the
    // home view samples first, so if the fetch went wrong these are the ones that
    // would show it.
    for (const z of [TERRAIN_MINZOOM, TERRAIN_MAXZOOM]) {
      const p = tile(z, lonToX(-117.234, z), latToY(32.881, z));
      const bytes = readFileSync(p);
      expect(statSync(p).size, p).toBeGreaterThan(1024);
      expect([...bytes.subarray(0, 4)], p).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});

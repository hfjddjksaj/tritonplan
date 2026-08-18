// @vitest-environment node
// (jsdom's global URL mis-resolves file:// + relative "../.." on Windows —
// this file only touches the filesystem, so run it under plain Node instead.)
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_FONT_REGULAR, MAP_FONT_BOLD } from './map-style';
const dir = (f: string) => fileURLToPath(new URL(`../../public/map/fonts/${f}`, import.meta.url));
describe('bundled map glyphs', () => {
  it('ship both Inter stacks the style references, Latin ranges, as real PBFs', () => {
    for (const stack of [MAP_FONT_REGULAR, MAP_FONT_BOLD]) for (const range of ['0-255', '256-511']) {
      const p = dir(`${stack}/${range}.pbf`);
      expect(existsSync(p), p).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(5000);
      expect(readFileSync(p)[0]).toBe(0x0a); // protobuf field 1 (fontstacks), length-delimited
    }
  });
  it('the UI font is bundled too', () => {
    expect(statSync(fileURLToPath(new URL('../assets/fonts/inter-latin.woff2', import.meta.url))).size).toBeGreaterThan(20000);
  });
});

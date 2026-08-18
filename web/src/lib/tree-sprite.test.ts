import { describe, it, expect } from 'vitest';
import { treeSprite } from './tree-sprite';

/** The RGBA at (x, y) of a `size`-square sprite. */
function px(img: ReturnType<typeof treeSprite>, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

const greener = ([r, g, b]: number[]) => g! > r! + 10 && g! > b! + 10;
const brownish = ([r, g, b]: number[]) => r! > g! && g! > b! && r! > 70;

describe('treeSprite', () => {
  it('is a square RGBA buffer of the size asked for', () => {
    const img = treeSprite(48);
    expect([img.width, img.height]).toEqual([48, 48]);
    expect(img.data.length).toBe(48 * 48 * 4);
    const small = treeSprite(24);
    expect([small.width, small.height, small.data.length]).toEqual([24, 24, 24 * 24 * 4]);
  });

  it('is a green canopy over a brown trunk, on transparent ground', () => {
    const img = treeSprite(48);
    const canopy = px(img, 24, 14);
    expect(canopy[3]).toBe(255);
    expect(greener(canopy), `canopy ${canopy}`).toBe(true);

    // Just above the bottom edge, on the centre line: the trunk.
    const trunk = px(img, 24, 45);
    expect(trunk[3]).toBe(255);
    expect(brownish(trunk), `trunk ${trunk}`).toBe(true);

    // The corners are sky — an icon-anchor: bottom sprite with opaque corners
    // would draw a box around every tree.
    for (const [x, y] of [
      [0, 0],
      [47, 0],
      [0, 47],
      [47, 47],
    ]) {
      expect(px(img, x!, y!)[3], `corner ${x},${y}`).toBe(0);
    }
  });

  it('is lit from the top: the canopy darkens downwards', () => {
    const img = treeSprite(48);
    const top = px(img, 24, 9);
    const bottom = px(img, 24, 25);
    const sum = (p: number[]) => p[0]! + p[1]! + p[2]!;
    expect(sum(top)).toBeGreaterThan(sum(bottom));
  });

  it('meets the ground at the bottom edge, where MapLibre anchors it', () => {
    // icon-anchor: 'bottom' pins the sprite's bottom-centre to the tree's point,
    // so an empty last row would float every tree above the ground.
    const img = treeSprite(48);
    expect(px(img, 24, 47)[3]).toBeGreaterThan(200);
  });
});

import { describe, it, expect } from 'vitest';
import { MIN_STAGE_H, MIN_STAGE_W, stageSizeFor } from './useStageSize';

describe('stageSizeFor', () => {
  it('is the container box, edge to edge — the map is the page', () => {
    expect(stageSizeFor(1440, 900)).toEqual({ w: 1440, h: 900 });
    expect(stageSizeFor(390, 844)).toEqual({ w: 390, h: 844 });
  });

  it('never goes below the smallest canvas the map can lay out', () => {
    expect(stageSizeFor(200, 200)).toEqual({ w: MIN_STAGE_W, h: MIN_STAGE_H });
  });

  it('rounds fractional CSS pixels so the SVG renders at 1:1', () => {
    expect(stageSizeFor(1023.6, 767.4)).toEqual({ w: 1024, h: 767 });
  });
});

import { describe, it, expect } from 'vitest';
import { stageHeightFor } from './useStageSize';

describe('stageHeightFor', () => {
  it('gives a phone a portrait canvas that still fits the window', () => {
    expect(stageHeightFor(358, 844)).toBe(555); // 358 × 1.55, under the 654 px of room
    expect(stageHeightFor(358, 600)).toBe(420); // tiny window: floor wins
  });

  it('gives a desktop window as much height as it has, within the band', () => {
    expect(stageHeightFor(1300, 900)).toBe(710);
    expect(stageHeightFor(1300, 1400)).toBe(900); // capped
    expect(stageHeightFor(1300, 500)).toBe(480); // floored
  });
});

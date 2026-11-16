import { describe, it, expect } from 'vitest';
import { INSERTION_LINE, buildLine, lineSpec, poseLine } from './insertion-line';

const scale = (el: Element) =>
  /scale\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform')!)!.slice(1).map(Number);

describe('insertion line', () => {
  it('draws the scrollwork line', () => {
    expect(INSERTION_LINE).toBe('scroll');
  });

  it.each(['scroll', 'drop'] as const)('%s: an end mark each side and a line in two halves', (style) => {
    const host = document.createElement('div');
    const d = buildLine(host, style, 268);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('294');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    for (const part of ['l', 'r', 'lh', 'rh'] as const) {
      expect(d[part]).toBe(host.querySelector(`[data-part="${part}"]`));
      expect(d[part]).not.toBeNull();
    }
    expect(host.innerHTML).not.toMatch(/NaN|undefined/);
  });

  it('runs from gutter to gutter', () => {
    expect(lineSpec('scroll', 268)).toMatchObject({ a: 10, b: 284, grow: 'unfurl' });
    expect(lineSpec('drop', 268)).toMatchObject({ a: 6, b: 288, grow: 'swell' });
  });

  it('gives each scrollwork drawing its own gradient', () => {
    const id = (defs: string) => /id="([^"]+)"/.exec(defs)![1];
    expect(id(lineSpec('scroll', 268).defs)).not.toBe(id(lineSpec('scroll', 268).defs));
  });

  it('takes its colour from the host', () => {
    expect(lineSpec('scroll', 268).defs).toContain('currentColor');
    expect(lineSpec('drop', 268).svg).toContain('fill="currentColor"');
  });

  it('at rest the halves meet and the marks are full size', () => {
    for (const style of ['scroll', 'drop'] as const) {
      const d = buildLine(document.createElement('div'), style, 268);
      poseLine(d, 1, 0);
      expect(scale(d.lh)[0]).toBeCloseTo(1);
      expect(scale(d.rh)[0]).toBeCloseTo(1);
      expect(scale(d.l)).toEqual([expect.closeTo(1), expect.closeTo(1)]);
    }
  });

  it('on the move the halves draw back; drops swell, scrollwork does not', () => {
    const drop = buildLine(document.createElement('div'), 'drop', 268);
    poseLine(drop, 1, 1);
    expect(scale(drop.lh)[0]).toBeCloseTo(0.45);
    expect(scale(drop.l)[0]).toBeCloseTo(1.2);
    const scroll = buildLine(document.createElement('div'), 'scroll', 268);
    poseLine(scroll, 1, 1);
    expect(scale(scroll.lh)[0]).toBeCloseTo(0.45);
    expect(scale(scroll.l)[0]).toBeCloseTo(1);
  });

  it('arriving, the scrollwork opens out from under half size', () => {
    const d = buildLine(document.createElement('div'), 'scroll', 268);
    poseLine(d, 0, 0);
    expect(scale(d.l)[0]).toBeCloseTo(0.45);
    expect(scale(d.lh)[0]).toBeCloseTo(0);
  });
});

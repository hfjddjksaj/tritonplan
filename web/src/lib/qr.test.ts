import { describe, expect, it } from 'vitest';
import { qrSvg, qrScale } from './qr';

describe('qrSvg', () => {
  it('renders scalable standalone SVG markup with viewBox size', () => {
    const out = qrSvg('https://example.com/#p=3~abc');
    expect(out.svg).toContain('<svg');
    expect(out.svg).toContain('viewBox');
    // viewBoxSize should include the quiet zone (moduleCount + 2*margin)
    expect(out.viewBoxSize).toBe(out.moduleCount + 8);
  });
});

describe('qr rendering inputs', () => {
  it('reports the module count alongside the markup', () => {
    const out = qrSvg('https://plan.example/#p=abc');
    expect(out.svg.startsWith('<svg')).toBe(true);
    // Smallest QR is 21x21; anything real is bigger and always odd-sized.
    expect(out.moduleCount).toBeGreaterThanOrEqual(21);
  });

  it('grows the module count with the payload', () => {
    const small = qrSvg('https://plan.example/#p=' + 'x'.repeat(100)).moduleCount;
    const big = qrSvg('https://plan.example/#p=' + 'x'.repeat(1500)).moduleCount;
    expect(big).toBeGreaterThan(small);
  });

  it('carries a 4-module quiet zone, as the spec requires', () => {
    // createSvgTag emits viewBox "0 0 <total> <total>" where total = modules + 2*margin.
    const { svg, moduleCount } = qrSvg('https://plan.example/#p=abc');
    const box = /viewBox="0 0 (\d+) \1"/.exec(svg);
    expect(box).not.toBeNull();
    expect(Number(box![1]) - moduleCount).toBe(8);
  });
});

describe('qrScale', () => {
  it('gives whole pixels per viewBox unit (code + quiet zone)', () => {
    // Test values are viewBox sizes (moduleCount + 8 for the quiet zone)
    expect(qrScale(141, 820)).toBe(5); // (133+8) mod code, 820px available
    expect(qrScale(185, 820)).toBe(4); // (177+8) mod code, 820px available
    expect(qrScale(89, 820)).toBe(9);  // (81+8) mod code, 820px available
  });

  it('never drops below 2, even when the viewport is tiny', () => {
    // With a tiny viewport, scale floors to 2 to keep modules readable
    expect(qrScale(185, 200)).toBe(2); // (177+8) mod code, only 200px available
  });
});

import { describe, expect, it } from 'vitest';
import type { PlanState } from '@triton/shared';
import { QR_URL_BUDGET, qrShareForPlan, qrSvg, qrScale } from './qr';
import { shareUrl } from './share';
import { makePlan } from './share-v3.test-helpers';

describe('qrShareForPlan', () => {
  it('uses the full link when it fits the QR budget', () => {
    const plan = makePlan(3, 5);
    const qr = qrShareForPlan(plan, 'full');
    expect(qr).not.toBeNull();
    expect(qr!.mode).toBe('full');
    expect(qr!.url).toBe(shareUrl(plan, 'full'));
    expect(qr!.url.length).toBeLessThanOrEqual(QR_URL_BUDGET);
  });

  it('degrades to lite when the full link exceeds the budget', () => {
    // Many options per course inflates the Full (all-options) link while Lite
    // (selected option only) stays flat — the combination that actually
    // exercises degrade-to-lite for this fixture shape.
    const plan = makePlan(3, 80); // deliberately huge
    const full = shareUrl(plan, 'full');
    const qr = qrShareForPlan(plan, 'full');
    expect(full.length).toBeGreaterThan(QR_URL_BUDGET); // fixture must actually exceed the budget
    expect(qr!.mode).toBe('lite');
  });

  it('returns whichever format is shorter, preferring the requested on a tie', () => {
    const plan = makePlan(2, 3);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    const qr = qrShareForPlan(plan, 'lite');
    expect(qr!.url.length).toBe(Math.min(full.length, lite.length));
  });

  it('carries whichever format is actually shorter', () => {
    // Full (deflate) often beats Lite on real plans; fewer bytes = lower version
    // = bigger modules, so the QR should take the shorter one either way.
    const plan = makePlan(4, 5);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    const picked = qrShareForPlan(plan, 'full')!;
    expect(picked.url.length).toBe(Math.min(full.length, lite.length));
    expect(picked.mode).toBe(full.length <= lite.length ? 'full' : 'lite');
  });
});

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

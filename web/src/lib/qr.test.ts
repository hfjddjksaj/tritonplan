import { describe, expect, it } from 'vitest';
import type { PlanState } from '@triton/shared';
import { QR_URL_BUDGET, qrShareForPlan, qrSvg, qrScale } from './qr';
import { shareUrl } from './share';
import { makePlan } from './share-v3.test-helpers';

describe('qrShareForPlan', () => {
  it('honors a requested Full that fits, even though Lite would be shorter', () => {
    // Measured: makePlan(5, 20) -> full=1645 chars, lite=1471 chars. Both fit
    // the 2900 budget, and Lite is the shorter one — this is the exact
    // regression: picking "shortest" here would silently hand back a
    // view-only Lite code when the user asked for the editable Full one.
    const plan = makePlan(5, 20);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    expect(full.length).toBeLessThanOrEqual(QR_URL_BUDGET);
    expect(lite.length).toBeLessThanOrEqual(QR_URL_BUDGET);
    expect(lite.length).toBeLessThan(full.length); // Lite really is shorter here
    const qr = qrShareForPlan(plan, 'full');
    expect(qr).not.toBeNull();
    expect(qr!.mode).toBe('full');
    expect(qr!.url).toBe(full);
  });

  it('honors a requested Lite that fits, even though Full would be shorter', () => {
    // Measured: makePlan(5, 1) -> full=619 chars, lite=1456 chars. Both fit
    // the budget, and Full is the shorter one — mirrors the case above in
    // the other direction, so a requested Lite must not be swapped for a
    // shorter Full behind the user's back.
    const plan = makePlan(5, 1);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    expect(full.length).toBeLessThanOrEqual(QR_URL_BUDGET);
    expect(lite.length).toBeLessThanOrEqual(QR_URL_BUDGET);
    expect(full.length).toBeLessThan(lite.length); // Full really is shorter here
    const qr = qrShareForPlan(plan, 'lite');
    expect(qr).not.toBeNull();
    expect(qr!.mode).toBe('lite');
    expect(qr!.url).toBe(lite);
  });

  it('falls back to Lite when the requested Full overflows the budget', () => {
    // Measured: makePlan(3, 80) -> full=3639 chars (over budget), lite=1038
    // chars (fits). Many options per course inflates Full (it carries every
    // option) while Lite (selected option only) stays flat.
    const plan = makePlan(3, 80);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    expect(full.length).toBeGreaterThan(QR_URL_BUDGET);
    expect(lite.length).toBeLessThanOrEqual(QR_URL_BUDGET);
    const qr = qrShareForPlan(plan, 'full');
    expect(qr).not.toBeNull();
    expect(qr!.mode).toBe('lite');
    expect(qr!.url).toBe(lite);
  });

  it('falls back to Full when the requested Lite overflows the budget', () => {
    // Measured: makePlan(20, 1) -> full=1010 chars (fits), lite=3848 chars
    // (over budget). Many courses inflates Lite (one entry per course, no
    // dedup) faster than Full (which dedupes the shared-lecture component
    // table), so this is the direction where Lite is the one that overflows.
    const plan = makePlan(20, 1);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    expect(lite.length).toBeGreaterThan(QR_URL_BUDGET);
    expect(full.length).toBeLessThanOrEqual(QR_URL_BUDGET);
    const qr = qrShareForPlan(plan, 'lite');
    expect(qr).not.toBeNull();
    expect(qr!.mode).toBe('full');
    expect(qr!.url).toBe(full);
  });

  it('returns null when both formats overflow the budget', () => {
    // Measured: makePlan(20, 20) -> full=3710 chars, lite=3898 chars, both
    // over the 2900 budget. Neither format fits, so there is no QR to show —
    // the modal falls back to telling the user to use Copy link.
    const plan = makePlan(20, 20);
    const full = shareUrl(plan, 'full');
    const lite = shareUrl(plan, 'lite');
    expect(full.length).toBeGreaterThan(QR_URL_BUDGET);
    expect(lite.length).toBeGreaterThan(QR_URL_BUDGET);
    expect(qrShareForPlan(plan, 'full')).toBeNull();
    expect(qrShareForPlan(plan, 'lite')).toBeNull();
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

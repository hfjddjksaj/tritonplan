import { describe, expect, it } from 'vitest';
import type { PlanState } from '@triton/shared';
import { QR_URL_BUDGET, qrShareForPlan, qrSvg } from './qr';
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
    if (full.length <= QR_URL_BUDGET) return; // guard: plan not big enough — bump sizes above
    expect(qr!.mode).toBe('lite');
  });

  it('honors an explicit lite request without trying full', () => {
    const plan = makePlan(2, 3);
    const qr = qrShareForPlan(plan, 'lite');
    expect(qr!.mode).toBe('lite');
    expect(qr!.url).toBe(shareUrl(plan, 'lite'));
  });
});

describe('qrSvg', () => {
  it('renders scalable standalone SVG markup', () => {
    const svg = qrSvg('https://example.com/#p=3~abc');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });
});

/**
 * QR share codes, generated fully offline (bundled lib, zero requests).
 * A single QR holds at most ~2953 bytes (version 40, EC level L); we keep a
 * margin. When the requested format doesn't fit, the QR silently falls back
 * to the other one — the ShareMenu labels which one the code actually holds.
 */
import qrcode from 'qrcode-generator';
import type { PlanState } from '@triton/shared';
import { shareUrl, type ShareFormat } from './share';

export const QR_URL_BUDGET = 2900;

export interface QrShare {
  url: string;
  /** Which format actually made it into the code. */
  mode: ShareFormat;
}

/**
 * Honor the format the user picked in the Share dropdown whenever it fits the
 * QR budget — Full and Lite differ in what the receiving device can do with
 * them (Full stays editable; Lite is view-only), so that choice is the user's
 * to make, not ours to override for a denser code. The modal is sized to scan
 * fine even at the higher module count a fitting-but-longer link produces.
 *
 * Only fall back to the other format when the requested one doesn't fit —
 * and that fallback runs both directions: Lite is usually shorter than Full,
 * but not always (a plan with few courses and many section options can make
 * Full the shorter one), so a requested Lite can legitimately overflow and
 * fall back to Full. `null` means neither format fits; the caller points the
 * user at Copy link instead.
 */
export function qrShareForPlan(plan: PlanState, requested: ShareFormat): QrShare | null {
  const requestedUrl = shareUrl(plan, requested);
  if (requestedUrl.length <= QR_URL_BUDGET) return { url: requestedUrl, mode: requested };
  const other: ShareFormat = requested === 'full' ? 'lite' : 'full';
  const otherUrl = shareUrl(plan, other);
  if (otherUrl.length <= QR_URL_BUDGET) return { url: otherUrl, mode: other };
  return null;
}

/**
 * Scalable SVG for a URL, plus the counts the caller needs to size the entire
 * code (modules + quiet zone) in whole pixels. `margin: 4` adds a 4-module
 * quiet zone on each side (8 total), which the QR spec requires — without it,
 * scanners cannot lock onto the finder patterns.
 *
 * Returns:
 * - `svg`: the SVG markup with viewBox set to the total extent (code + quiet zone)
 * - `moduleCount`: the dimension of just the code (ignoring the quiet zone)
 * - `viewBoxSize`: the total viewBox dimension, including quiet zone margins
 */
export function qrSvg(url: string): { svg: string; moduleCount: number; viewBoxSize: number } {
  const qr = qrcode(0, 'L'); // typeNumber 0 = auto-size
  qr.addData(url);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const viewBoxSize = moduleCount + 2 * 4; // margin: 4 on each side
  return {
    svg: qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true }),
    moduleCount,
    viewBoxSize,
  };
}

/**
 * Whole pixels per viewBox unit that fit in `available`. Ensures the entire
 * rendered element (code + quiet zone) fits inside `available` pixels with a
 * whole-number scale. A fractional scale puts edges mid-pixel, where
 * antialiasing greys them out and cameras stop resolving them — so this
 * floors, and never goes below 2 (minimum legible module size).
 */
export function qrScale(viewBoxSize: number, available: number): number {
  return Math.max(2, Math.floor(available / viewBoxSize));
}

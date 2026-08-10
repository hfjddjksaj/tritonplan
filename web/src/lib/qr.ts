/**
 * QR share codes, generated fully offline (bundled lib, zero requests).
 * A single QR holds at most ~2953 bytes (version 40, EC level L); we keep a
 * margin. When the Full link is too big, the QR silently carries the Lite
 * link instead — the ShareMenu labels which one the code holds.
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
 * Pick the link that makes the easiest-to-scan code: whichever of the two
 * formats is shorter and fits, preferring the requested one on a tie. Fewer
 * characters means a lower QR version, which means larger modules.
 */
export function qrShareForPlan(plan: PlanState, requested: ShareFormat): QrShare | null {
  const candidates: QrShare[] = [
    { url: shareUrl(plan, 'full'), mode: 'full' },
    { url: shareUrl(plan, 'lite'), mode: 'lite' },
  ].filter((c) => c.url.length <= QR_URL_BUDGET);
  if (candidates.length === 0) return null;
  const shortest = Math.min(...candidates.map((c) => c.url.length));
  const best = candidates.filter((c) => c.url.length === shortest);
  return best.find((c) => c.mode === requested) ?? best[0]!;
}

/**
 * Scalable SVG for a URL, plus the module count the caller needs to size it in
 * whole pixels. `margin: 4` is the quiet zone the QR spec requires — with less,
 * a scanner cannot lock onto the finder patterns.
 */
export function qrSvg(url: string): { svg: string; moduleCount: number } {
  const qr = qrcode(0, 'L'); // typeNumber 0 = auto-size
  qr.addData(url);
  qr.make();
  return {
    svg: qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true }),
    moduleCount: qr.getModuleCount(),
  };
}

/**
 * Whole pixels per module that fit in `available`. A fractional scale puts
 * module edges mid-pixel, where antialiasing greys them out and the camera
 * stops resolving them — so this floors, and never goes below 2.
 */
export function qrScale(moduleCount: number, available: number): number {
  return Math.max(2, Math.floor(available / moduleCount));
}

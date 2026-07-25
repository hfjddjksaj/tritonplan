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

/** Pick the best link that fits a QR: requested format first, then Lite, else null. */
export function qrShareForPlan(plan: PlanState, requested: ShareFormat): QrShare | null {
  if (requested === 'full') {
    const full = shareUrl(plan, 'full');
    if (full.length <= QR_URL_BUDGET) return { url: full, mode: 'full' };
  }
  const lite = shareUrl(plan, 'lite');
  if (lite.length <= QR_URL_BUDGET) return { url: lite, mode: 'lite' };
  return null;
}

/** Standalone scalable SVG markup for a QR of the given URL. */
export function qrSvg(url: string): string {
  const qr = qrcode(0, 'L'); // typeNumber 0 = auto-size
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

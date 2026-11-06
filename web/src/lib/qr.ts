/**
 * QR share codes, generated fully offline (bundled lib, zero requests).
 * The payload is always a short /s/<code> link, so the code stays small.
 */
import qrcode from 'qrcode-generator';

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

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { qrSvg, qrScale } from '../lib/qr';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { X } from './icons';

/** Widest the code is allowed to get; past this, bigger stops buying clarity. */
const MAX_PX = 820;

/** `.mappop` padding (`18px 20px 16px`, border-box) — the code's box lives inside that, not the viewport. */
const CARD_PADDING_X = 20;

/** Room for the code: bounded by width on a phone, by height on a short screen. */
function availablePx(): number {
  return Math.min(window.innerWidth * 0.92 - 2 * CARD_PADDING_X, window.innerHeight * 0.78, MAX_PX);
}

interface Props {
  /** The short share link; it is short enough that the code is always a small, easily scanned one. */
  url: string;
  onClose: () => void;
}

/**
 * Full-size share QR. It lives in a centered modal rather than in the Share
 * dropdown so the code can be sized to the screen and scan from across a table.
 *
 * Portaled to <body>: the topbar is a positioned ancestor, and a fixed overlay
 * inside it would be constrained by it.
 */
export function QrPopover({ url, onClose }: Props) {
  useEscapeKey(onClose);
  const [available, setAvailable] = useState(availablePx);
  useEffect(() => {
    const onResize = () => setAvailable(availablePx());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const code = useMemo(() => qrSvg(url), [url]);
  // Size the whole SVG (code + quiet zone), not just the module grid — the
  // viewBox spans viewBoxSize units, so scaling by that (not moduleCount)
  // keeps px-per-module exactly equal to the scale.
  const scale = qrScale(code.viewBoxSize, available);
  const sizePx = code.viewBoxSize * scale;

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop qrpop"
        role="dialog"
        aria-modal="true"
        aria-label="Share this plan by QR code"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Scan to open this plan</div>
        {/* qrSvg output is generated locally by qrcode-generator — trusted markup */}
        <div
          className="qrpop__code"
          style={{ width: sizePx, height: sizePx }}
          dangerouslySetInnerHTML={{ __html: code.svg }}
        />
        <p className="qrpop__note">Anyone with this link can view the plan.</p>
      </div>
    </div>,
    document.body,
  );
}

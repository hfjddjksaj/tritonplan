import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlanState } from '@triton/shared';
import { qrShareForPlan, qrSvg, qrScale } from '../lib/qr';
import type { ShareFormat } from '../lib/share';
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
  plan: PlanState;
  format: ShareFormat;
  onClose: () => void;
}

/**
 * Full-size share QR. It lives in a centered modal rather than in the Share
 * dropdown because the dropdown is 272px wide — a realistic plan is ~133 modules,
 * which came out at 1.68px per module there and would not scan.
 *
 * Portaled to <body>: the topbar is a positioned ancestor, and a fixed overlay
 * inside it would be constrained by it.
 */
export function QrPopover({ plan, format, onClose }: Props) {
  useEscapeKey(onClose);
  const [available, setAvailable] = useState(availablePx);
  useEffect(() => {
    const onResize = () => setAvailable(availablePx());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const qr = useMemo(() => qrShareForPlan(plan, format), [plan, format]);
  const code = useMemo(() => (qr ? qrSvg(qr.url) : null), [qr]);
  // Size the whole SVG (code + quiet zone), not just the module grid — the
  // viewBox spans viewBoxSize units, so scaling by that (not moduleCount)
  // keeps px-per-module exactly equal to the scale.
  const scale = code ? qrScale(code.viewBoxSize, available) : 0;
  const sizePx = code ? code.viewBoxSize * scale : 0;

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
        {code ? (
          <>
            {/* qrSvg output is generated locally by qrcode-generator — trusted markup */}
            <div
              className="qrpop__code"
              style={{ width: sizePx, height: sizePx }}
              dangerouslySetInnerHTML={{ __html: code.svg }}
            />
            {qr!.mode === 'lite' && format === 'full' && (
              <p className="qrpop__note">
                Plan too large for a full QR — this code carries the Lite version. Use Copy link to
                send everything.
              </p>
            )}
            {qr!.mode === 'full' && format === 'lite' && (
              <p className="qrpop__note">
                Full came out shorter than Lite for this plan, so this code carries the Full
                version — editable on the other device, not view-only.
              </p>
            )}
          </>
        ) : (
          <p className="qrpop__note">
            This plan is too large for a QR code — use Copy link instead.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

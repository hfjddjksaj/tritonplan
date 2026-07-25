import { useMemo, useRef, useState } from 'react';
import type { PlanState } from '@triton/shared';
import { useClickAway } from '../hooks/useClickAway';
import { encodePlan, shareUrl, type ShareFormat } from '../lib/share';
import { qrShareForPlan, qrSvg } from '../lib/qr';
import { saveSyncedToken } from '../lib/storage';
import { ChevronDown, Link, QrCode, Share } from './icons';

interface Props {
  /** The plan on screen — yours, or a received one you're passing along. */
  plan: PlanState;
  onFlash: (msg: string) => void;
}

/**
 * Share ▾ — Copy link / QR code, with a Full (default) vs Lite format toggle.
 * Full = v3 token, every section option included, editable after saving on the
 * other device. Lite = v2 slim snapshot, view-only. "Export as JSON" is shelved
 * for now (kept below, commented out) — Import → Upload still accepts old files.
 */
export function ShareMenu({ plan, onFlash }: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ShareFormat>('full');
  const [qrOpen, setQrOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => {
    setOpen(false);
    setQrOpen(false);
  });

  const qr = useMemo(
    () => (open && qrOpen ? qrShareForPlan(plan, format) : null),
    [open, qrOpen, plan, format],
  );
  const qrMarkup = useMemo(() => (qr ? qrSvg(qr.url) : ''), [qr]);

  const close = () => {
    setOpen(false);
    setQrOpen(false);
  };

  const copyLink = async () => {
    const token = encodePlan(plan, format);
    const url = shareUrl(plan, format);
    try {
      await navigator.clipboard.writeText(url);
      onFlash(
        format === 'full'
          ? 'Full link copied — every section option included'
          : 'Lite link copied — view-only snapshot',
      );
    } catch {
      // Clipboard unavailable — expose the link via the address bar instead.
      // Mark it as our own write so the next load doesn't re-import it.
      saveSyncedToken(token);
      window.history.replaceState(null, '', `#p=${token}`);
      onFlash('Share link is in the address bar — copy it from there');
    }
    close();
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Share size={15} /> Share <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu menu--right" role="menu">
          <div className="menu__seg" role="radiogroup" aria-label="Share format">
            <button
              type="button"
              role="radio"
              aria-checked={format === 'full'}
              className={`menu__seg-btn${format === 'full' ? ' menu__seg-btn--on' : ''}`}
              onClick={() => setFormat('full')}
            >
              Full
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={format === 'lite'}
              className={`menu__seg-btn${format === 'lite' ? ' menu__seg-btn--on' : ''}`}
              onClick={() => setFormat('lite')}
            >
              Lite
            </button>
          </div>
          <p className="menu__seg-desc">
            {format === 'full'
              ? 'All sections included — editable on the other device.'
              : 'Selected sections only — smaller link, view-only.'}
          </p>

          <button type="button" className="menu__item" role="menuitem" onClick={copyLink}>
            <span className="menu__item-title">
              <Link size={14} /> Copy link
            </span>
            <span className="menu__item-desc">
              Send it anywhere — the plan travels inside the link itself.
            </span>
          </button>

          <button
            type="button"
            className="menu__item"
            role="menuitem"
            aria-expanded={qrOpen}
            onClick={() => setQrOpen((v) => !v)}
          >
            <span className="menu__item-title">
              <QrCode size={14} /> QR code
            </span>
            <span className="menu__item-desc">Scan with your phone to open this plan there.</span>
          </button>
          {qrOpen &&
            (qr ? (
              <div className="menu__qr">
                {/* qrSvg output is generated locally from qrcode-generator — trusted markup */}
                <div className="menu__qr-box" dangerouslySetInnerHTML={{ __html: qrMarkup }} />
                {qr.mode === 'lite' && format === 'full' && (
                  <p className="menu__qr-note">
                    Plan too large for a full QR — this code carries the Lite version. Use Copy
                    link for the full plan.
                  </p>
                )}
              </div>
            ) : (
              <p className="menu__qr-note">
                This plan is too large for a QR code — use Copy link instead.
              </p>
            ))}

          {/* Export as JSON — shelved 2026-07-24 (user decision; Import → Upload still works).
              Re-enable by restoring this block and the downloadPlanJson import.
          <button type="button" className="menu__item" role="menuitem"
            onClick={() => { close(); downloadPlanJson(plan); onFlash('Plan exported as JSON'); }}>
            <span className="menu__item-title"><Download size={14} /> Export as JSON</span>
            <span className="menu__item-desc">The complete plan, every section option included.
              To open it: click Import → upload the file, and the plan is right there.</span>
          </button>
          */}
        </div>
      )}
    </div>
  );
}

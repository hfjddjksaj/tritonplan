import { useRef, useState } from 'react';
import type { PlanState } from '@triton/shared';
import { useClickAway } from '../hooks/useClickAway';
import { encodePlan, shareUrl, tokenFromHash, type ShareFormat } from '../lib/share';
import { saveSyncedToken } from '../lib/storage';
import { ChevronDown, Link, QrCode, Share } from './icons';
import { QrPopover } from './QrPopover';

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
  // Only the dropdown closes on an outside click — the QR modal is portaled
  // to <body>, outside `ref`, so a click inside it would otherwise register
  // as "outside" too and take the modal down with the dropdown. The modal
  // closes on its own terms (backdrop click, its close button, or Escape).
  useClickAway(open, ref, () => setOpen(false));

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
      // Store the marker in the same form the consume effect will read back:
      // URLSearchParams turns a literal '+' (present in lite/lz-string tokens)
      // into a space, so normalize through the same parser.
      saveSyncedToken(tokenFromHash(`#p=${token}`) ?? token);
      window.history.replaceState(null, '', `#p=${token}`);
      onFlash('Share link is in the address bar — copy it from there');
    }
    close();
  };

  return (
    <>
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
            <div className="menu__seg" role="group" aria-label="Share format">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={format === 'full'}
                className={`menu__seg-btn${format === 'full' ? ' menu__seg-btn--on' : ''}`}
                onClick={() => setFormat('full')}
              >
                Full
              </button>
              <button
                type="button"
                role="menuitemradio"
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
              onClick={() => {
                // Close the dropdown itself (z-index 40) so it doesn't sit dimmed and
                // unclickable behind the modal's backdrop (z-index 90). The modal
                // (qrOpen) is a separate, portaled sibling — see the useClickAway
                // comment above for why closing `open` here must not touch it.
                setOpen(false);
                setQrOpen((v) => !v);
              }}
            >
              <span className="menu__item-title">
                <QrCode size={14} /> QR code
              </span>
              <span className="menu__item-desc">Scan with your phone to open this plan there.</span>
            </button>

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
      {qrOpen && <QrPopover plan={plan} format={format} onClose={() => setQrOpen(false)} />}
    </>
  );
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listShares, revokeShare, type ShareRow } from '../lib/cloud/api';
import { useEscapeKey } from '../hooks/useEscapeKey';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sharedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Shared' : `Shared ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Every link this account has handed out, each with a way to turn it off. */
export function SharedLinksDialog({ onClose, onFlash }: { onClose: () => void; onFlash: (msg: string) => void }) {
  useEscapeKey(onClose);
  // undefined = loading, null = could not load
  const [rows, setRows] = useState<ShareRow[] | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void listShares().then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, []);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      onFlash('Link copied.');
    } catch {
      onFlash(`Couldn't copy automatically — the link is ${url}`);
    }
  }

  async function turnOff(code: string) {
    if (busy) return;
    setBusy(true);
    const ok = await revokeShare(code);
    setBusy(false);
    if (ok) {
      setRows((rs) => rs && rs.filter((r) => r.code !== code));
      setConfirming(null);
    } else {
      onFlash("Couldn't turn that link off. Please try again.");
    }
  }

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop acctdlg"
        role="dialog"
        aria-modal="true"
        aria-label="Shared links"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">Shared links</h2>
        {rows === undefined && <p className="planpick__sub">Loading…</p>}
        {rows === null && <p className="planpick__sub">Couldn't load your shared links.</p>}
        {rows && rows.length === 0 && <p className="planpick__sub">You haven't shared any plans yet.</p>}
        {rows && rows.length > 0 && (
          <ul className="sharedlinks">
            {rows.map((r) => (
              <li key={r.code} className="sharedlinks__row">
                <div className="sharedlinks__info">
                  <span className="sharedlinks__name">{r.name}</span>
                  <span className="sharedlinks__date">{sharedOn(r.createdAt)}</span>
                </div>
                {confirming === r.code ? (
                  <>
                    <p className="sharedlinks__ask">
                      Turn off this link? Anyone who opens it will see that it no longer works.
                    </p>
                    <div className="acctdlg__actions">
                      <button type="button" className="btn btn--sm" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm acctdlg__danger"
                        disabled={busy}
                        onClick={() => void turnOff(r.code)}
                      >
                        Turn off
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="acctdlg__actions">
                    <button type="button" className="btn btn--sm" onClick={() => void copy(r.url)}>
                      Copy
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => setConfirming(r.code)}>
                      Turn off
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="acctdlg__actions">
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

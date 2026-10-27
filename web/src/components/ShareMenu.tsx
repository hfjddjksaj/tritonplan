import { useRef, useState } from 'react';
import type { PlanState } from '@triton/shared';
import { useClickAway } from '../hooks/useClickAway';
import { createShare } from '../lib/cloud/api';
import { ChevronDown, Link, QrCode, Share } from './icons';
import { QrPopover } from './QrPopover';

interface Props {
  /** The plan on screen — yours, or a received one you're passing along. */
  plan: PlanState;
  /** What the link will be listed as under "Shared links". */
  planName: string;
  onFlash: (msg: string) => void;
}

const CREATE_FAILED = "Couldn't create a link. Check your connection and try again.";

/**
 * Share ▾ — Copy link / QR code. Either one saves a snapshot of the plan on
 * the server and hands out its short link; the student can turn the link off
 * later from the account menu. The snapshot is the full plan, so whoever opens
 * it can save and edit their own copy.
 */
export function ShareMenu({ plan, planName, onFlash }: Props) {
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // One link per opening of the menu: a double click, or Copy then QR, shares the same snapshot
  // instead of leaving stray links behind in the student's list.
  const link = useRef<Promise<string | null> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Only the dropdown closes on an outside click — the QR modal is portaled
  // to <body>, outside `ref`, so a click inside it would otherwise register
  // as "outside" too and take the modal down with the dropdown. The modal
  // closes on its own terms (backdrop click, its close button, or Escape).
  useClickAway(open, ref, () => setOpen(false));

  const ensureLink = (): Promise<string | null> => {
    if (!link.current) {
      const p = createShare(planName, plan).then((r) => r?.url ?? null);
      link.current = p;
      // A failure must not be remembered, or Try again would just replay it.
      void p.then((url) => { if (!url && link.current === p) link.current = null; });
    }
    return link.current;
  };

  const copyLink = async () => {
    const pending = ensureLink();
    // WebKit (every iPhone browser) lets a page write the clipboard only inside the click, and the link
    // arrives after it. A ClipboardItem takes a promise, so the write starts now and fills in once the link exists;
    // a failed create rejects that promise and nothing is written.
    let copied: Promise<boolean> | null = null;
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const text = pending.then((url) => {
        if (!url) throw new Error('no link');
        return new Blob([url], { type: 'text/plain' });
      });
      void text.catch(() => {}); // a failed create is reported below, from `pending`
      try {
        copied = navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]).then(() => true, () => false);
      } catch {
        // A ClipboardItem that refuses a promise: copy the text once the link exists instead.
      }
    }
    const url = await pending;
    if (!url) {
      onFlash(CREATE_FAILED);
      return;
    }
    let ok = false;
    try {
      if (copied) {
        ok = await copied;
      } else {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      // No clipboard API here, or it refused: the flash shows the link instead.
    }
    onFlash(ok ? 'Link copied — anyone with it can view this plan.' : `Couldn't copy automatically — your link is ${url}`);
    setOpen(false);
  };

  const showQr = async () => {
    const url = await ensureLink();
    if (!url) {
      onFlash(CREATE_FAILED);
      return;
    }
    // Close the dropdown itself (z-index 40) so it doesn't sit dimmed and
    // unclickable behind the modal's backdrop (z-index 90). The modal is a
    // separate, portaled sibling — see the useClickAway comment above.
    setOpen(false);
    setQrUrl(url);
  };

  return (
    <>
      <div className="menu-wrap" ref={ref}>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            if (!open) link.current = null;
            setOpen((v) => !v);
          }}
        >
          <Share size={15} /> Share <ChevronDown size={12} />
        </button>
        {open && (
          <div className="menu menu--right" role="menu">
            <button type="button" className="menu__item" role="menuitem" onClick={copyLink}>
              <span className="menu__item-title">
                <Link size={14} /> Copy link
              </span>
              <span className="menu__item-desc">
                A short link to a snapshot of this plan. You can turn it off any time.
              </span>
            </button>

            <button type="button" className="menu__item" role="menuitem" onClick={showQr}>
              <span className="menu__item-title">
                <QrCode size={14} /> QR code
              </span>
              <span className="menu__item-desc">Scan with your phone to open this plan there.</span>
            </button>
          </div>
        )}
      </div>
      {qrUrl && <QrPopover url={qrUrl} onClose={() => setQrUrl(null)} />}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createSharedPlan, listSharedPlans, type SharedLink } from '../../lib/cloud/api';
import { expiryText } from '../../lib/format';
import { qrSvg } from '../../lib/qr';
import { displayTermLabel, termOf } from '../../lib/terms';
import type { PlanState } from '@triton/shared';
import { Dialog } from '../Dialog';
import { Message } from '../Field';
import { Copy, QrCode } from '../icons';

export interface SharablePlan { id: string; name: string; plan: PlanState }

const ERRORS: Record<string, string> = {
  too_many_shares: 'You have too many live links. Wait for one to expire.',
  rate_limited: 'Too many requests. Try again in a moment.',
  network: "Couldn't reach TritonPlan. Check your connection and try again.",
};

/** "Fall 2026" for a stored `year|period` key; the raw key when it doesn't parse. */
function termLabelOf(key: string): string {
  const [year, period] = key.split('|');
  return year && period ? displayTermLabel(termOf(year, period)) : key;
}

/** Newest first, so a link made a moment ago is the first thing on screen. */
const newestFirst = (a: SharedLink, b: SharedLink) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

export function ShareFriendsDialog({
  plans, onClose, onCopied,
}: {
  /** The plans of the term on screen. */
  plans: SharablePlan[];
  onClose: () => void;
  onCopied: (msg: string) => void;
}) {
  const [links, setLinks] = useState<SharedLink[] | null | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const live = useRef(true);
  const now = Date.now();
  // An empty plan has nothing for a friend to look at.
  const offered = plans.filter((p) => p.plan.entries.length > 0);

  useEffect(() => {
    live.current = true;
    void listSharedPlans().then((l) => { if (live.current) setLinks(l ? [...l].sort(newestFirst) : null); });
    return () => { live.current = false; };
  }, []);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      onCopied('Link copied');
    } catch {
      onCopied(`Couldn't copy automatically — the link is ${url}`);
    }
  }

  async function create(p: SharablePlan) {
    if (busy) return;
    setBusy(true);
    setAsking(false);
    setError(null);
    const created = createSharedPlan(p.name, p.plan);
    // WebKit (every iPhone browser) lets a page write the clipboard only inside the click, and the link
    // arrives after it. A ClipboardItem takes a promise, so the write starts now and fills in once the link
    // exists; a failed create rejects that promise and nothing is written.
    let copied: Promise<boolean> | null = null;
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const text = created.then((r) => {
        if ('error' in r) throw new Error(r.error);
        return new Blob([r.url], { type: 'text/plain' });
      });
      void text.catch(() => {}); // a failed create is reported below, from `created`
      try {
        copied = navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]).then(() => true, () => false);
      } catch {
        // A ClipboardItem that refuses a promise: copy the text once the link exists instead.
      }
    }
    const r = await created;
    if (!live.current) return;
    if ('error' in r) {
      setBusy(false);
      setError(ERRORS[r.error] ?? "Couldn't create the link. Please try again.");
      return;
    }
    // The list is the server's view (term, creation time); re-read it rather than guess a row.
    const l = await listSharedPlans();
    if (!live.current) return;
    setBusy(false);
    if (l) setLinks([...l].sort(newestFirst));
    if (copied) onCopied((await copied) ? 'Link copied' : `Couldn't copy automatically — the link is ${r.url}`);
    else await copy(r.url);
  }

  function newShare() {
    if (offered.length === 1) void create(offered[0]!);
    else setAsking((v) => !v);
  }

  return (
    <Dialog
      label="Share with friends"
      className="sharedlg"
      onClose={onClose}
      eyebrow="Share with friends"
      title="Your shared links"
      meta="Anyone with a link can switch sections for 7 days. Your own plan doesn't change."
      busy={busy}
    >
      {links === undefined && <p className="mappop__hint">Loading…</p>}
      {links === null && <Message tone="error">Couldn't load your shared links.</Message>}
      {links && links.length === 0 && <p className="mappop__hint">Nothing shared right now.</p>}
      {links && links.length > 0 && (
        <ul className="sharelist">
          {links.map((l) => (
            <li key={l.code} className="sharelist__item">
              <div className="sharelist__row">
                <button type="button" className="sharelist__main" onClick={() => void copy(l.url)}>
                  <span className="sharelist__name">{l.name}</span>
                  <span className="sharelist__meta">
                    {termLabelOf(l.termKey)} · {expiryText(l.expiresAt, now)}
                  </span>
                </button>
                <span className="sharelist__icon" aria-hidden="true"><Copy size={13} /></span>
                <button
                  type="button"
                  className="btn btn--sm btn--icon"
                  aria-label={`QR code for ${l.name}`}
                  aria-pressed={qrFor === l.code}
                  onClick={() => setQrFor((c) => (c === l.code ? null : l.code))}
                >
                  <QrCode size={14} />
                </button>
              </div>
              {qrFor === l.code && <QrBlock url={l.url} />}
            </li>
          ))}
        </ul>
      )}
      {error && <Message tone="error">{error}</Message>}
      {asking && (
        <div className="sharelist__ask">
          <p className="mappop__hint">Which plan?</p>
          {offered.map((p) => (
            <button key={p.id} type="button" className="btn btn--sm" onClick={() => void create(p)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary sharedlg__new"
        disabled={busy || offered.length === 0}
        onClick={newShare}
      >
        New share
      </button>
      {offered.length === 0 && <p className="mappop__hint">Add a course to a plan to share it.</p>}
    </Dialog>
  );
}

function QrBlock({ url }: { url: string }) {
  const code = useMemo(() => qrSvg(url), [url]);
  // qrSvg output is generated locally by qrcode-generator, so the markup is trusted.
  return <div className="sharelist__qr" dangerouslySetInnerHTML={{ __html: code.svg }} />;
}

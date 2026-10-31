/**
 * The old GitHub Pages site, reduced to a hand-off page: it finds the plans in
 * this browser's localStorage and passes them to tritonplan.cn. Plain DOM, no
 * React, so the card is up at once (main.ts then loads the blurred backdrop
 * of the old planner behind it). It only ever READS storage — the old data is
 * the student's fallback until they have confirmed the move — and it hands the
 * payload over only when the tab it opened asks for it (`ready`), never
 * unprompted, and only to SITE_ORIGIN.
 */
import { pluralize } from '../src/lib/format';
import { collectLegacyPayload, mergeMigration, MIGRATE_MSG, type MigrationPayload } from '../src/lib/migration';
import { SITE_ORIGIN } from '../src/lib/site';

const BLOCKED =
  'Your browser blocked the new tab. Allow pop-ups for this page, or download a backup file and import it on tritonplan.cn.';

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, text?: string, cls?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** Local calendar date, so the file name matches the student's own clock. */
function localDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Draws the card and returns what it gathered (null when it redirected or found nothing readable). */
export function runOldSite(doc: Document, win: Window, nowIso: string): MigrationPayload | null {
  // A shared plan link must reach the new site without a flash of this page.
  // `#m=` (a bookmarked own plan) is not a share link: it feeds the payload below.
  if (new URLSearchParams(win.location.hash.replace(/^#/, '')).has('p')) {
    win.location.replace(SITE_ORIGIN + '/' + win.location.hash);
    return null;
  }

  // Corrupt storage must not strand the student on a blank page: degrade to what we could gather.
  let payload: MigrationPayload | null = null;
  let n: number | null = null; // null = could not count, so offer the move anyway
  try {
    payload = collectLegacyPayload(win.location.hash, nowIso);
    n = mergeMigration({ terms: null, pool: [], appt: null }, payload, nowIso).added.plans;
  } catch {
    /* keep whatever was collected */
  }

  const root = doc.getElementById('app') ?? doc.body;
  root.textContent = '';
  const card = el(doc, 'main', undefined, 'moved');
  card.append(
    el(doc, 'h1', 'TritonPlan has moved to tritonplan.cn'),
    el(
      doc, 'p',
      'Your plans now live in your account, so they follow you to any device. Sign in on the new site with Google or with your email.',
    ),
  );
  const status = el(doc, 'p', undefined, 'moved__status');
  status.setAttribute('role', 'status');

  if (payload && (n === null || n > 0)) {
    const data = payload;
    const move = el(doc, 'button', 'Move my plans to tritonplan.cn', 'moved__btn moved__btn--primary');
    move.type = 'button';
    const backup = el(doc, 'button', 'Download a backup file', 'moved__btn');
    backup.type = 'button';
    if (n !== null) card.append(el(doc, 'p', `This browser has ${n} saved ${pluralize(n, 'plan')}.`, 'moved__count'));
    const row = el(doc, 'div', undefined, 'moved__actions');
    row.append(move, backup);
    card.append(row, status);

    let stop: (() => void) | null = null;
    move.addEventListener('click', () => {
      stop?.(); // a fresh click is a fresh handshake with a fresh tab
      status.textContent = 'Opening tritonplan.cn…';
      let tab: Window | null = null;
      const onMessage = (e: Event) => {
        const m = e as MessageEvent;
        if (!tab || m.origin !== SITE_ORIGIN || m.source !== tab) return;
        const type = (m.data as { type?: unknown } | null)?.type;
        if (type === MIGRATE_MSG.ready) {
          tab.postMessage({ type: MIGRATE_MSG.payload, payload: data }, SITE_ORIGIN);
        } else if (type === MIGRATE_MSG.ack) {
          status.textContent = 'Done — finish in the new tab.';
        }
      };
      // Listener first, so no message from the new tab can ever find us unattached.
      win.addEventListener('message', onMessage);
      stop = () => win.removeEventListener('message', onMessage);
      // No noopener: the receiver needs window.opener to find us.
      tab = win.open(SITE_ORIGIN + '/migrate?handoff=1', '_blank');
      if (tab === null) {
        stop();
        stop = null;
        status.textContent = BLOCKED;
      }
    });

    backup.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const a = el(doc, 'a');
      a.href = url;
      a.download = `tritonplan-backup-${localDate(nowIso)}.json`;
      doc.body.append(a);
      a.click();
      a.remove();
      // Not right away: Safari starts the download asynchronously and fails if the URL is already gone.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  } else {
    const go = el(doc, 'a', 'Go to tritonplan.cn', 'moved__btn moved__btn--primary');
    go.href = SITE_ORIGIN + '/';
    const row = el(doc, 'div', undefined, 'moved__actions');
    row.append(go);
    card.append(row);
  }

  // The extension update adds a host permission, and Chrome may disable it until the student accepts.
  card.append(
    el(
      doc,
      'p',
      'After the TritonPlan extension updates, Chrome may switch it off until you allow its new site. ' +
        'If the + TritonPlan button disappears from TSS, open chrome://extensions and turn TritonPlan back on.',
      'moved__foot',
    ),
  );
  root.append(card);
  return payload;
}

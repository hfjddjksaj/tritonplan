import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createCalendarLink, fetchCalendar, resetCalendarLink, saveCalendarTerms,
  type CalendarLinks, type CalendarState,
} from '../lib/cloud/api';
import type { TermsState } from '../lib/terms-state';
import { chronoIndex, displayTermLabel, isArchived, termKey } from '../lib/terms';
import { useEscapeKey } from '../hooks/useEscapeKey';

export interface CalendarRow { key: string; label: string; plans: { id: string; name: string }[] }

/** Only open terms with a plan can feed the calendar; a term nobody planned in, or one already over, has nothing to pick. */
export function calendarRows(terms: TermsState, now: Date = new Date()): CalendarRow[] {
  return Object.values(terms.terms)
    .filter((w) => w.plans.plans.length > 0 && !isArchived(w.term, now))
    .sort((a, b) => (chronoIndex(a.term) ?? Infinity) - (chronoIndex(b.term) ?? Infinity))
    .map((w) => ({
      key: termKey(w.term),
      label: displayTermLabel(w.term),
      plans: w.plans.plans.map((p) => ({ id: p.id, name: p.name })),
    }));
}

/** A term needs attention when it has no pick, or its pick was deleted. */
export function calendarNeedsPick(rows: CalendarRow[], cal: Pick<CalendarState, 'terms' | 'missing'>): boolean {
  return rows.some((r) => !cal.terms[r.key] || cal.missing.includes(r.key));
}

/** Pick one plan per term and subscribe to the result in Apple or Google Calendar. */
export function CalendarDialog({
  terms,
  onClose,
  onFlash,
  onChanged,
}: {
  terms: TermsState;
  onClose: () => void;
  onFlash: (msg: string) => void;
  /** Called after the server accepted a change, so the account menu can refresh its dot. */
  onChanged: () => void;
}) {
  useEscapeKey(onClose);
  // undefined = loading, null = could not load
  const [cal, setCal] = useState<CalendarState | null | undefined>(undefined);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const rows = calendarRows(terms);

  useEffect(() => {
    let live = true;
    void fetchCalendar().then((c) => {
      if (!live) return;
      setCal(c);
      if (c) {
        setPicks(c.terms);
        setMissing(c.missing);
        setLinks(c.https && c.webcal ? { https: c.https, webcal: c.webcal } : null);
      }
    });
    return () => { live = false; };
  }, []);

  async function choose(key: string, planId: string) {
    if (busy) return;
    const before = { picks, missing };
    // The server replaces the whole map, so send every pick (including ones for terms not listed here).
    const next = { ...picks };
    if (planId) next[key] = planId;
    else delete next[key];
    setPicks(next);
    setMissing((m) => m.filter((k) => k !== key));
    setSaveFailed(false);
    setBusy(true);
    const ok = await saveCalendarTerms(next);
    setBusy(false);
    if (ok) {
      onChanged();
    } else {
      setPicks(before.picks);
      setMissing(before.missing);
      setSaveFailed(true);
    }
  }

  async function makeLink(fn: () => Promise<CalendarLinks | null>, failure: string) {
    if (busy) return;
    setBusy(true);
    const l = await fn();
    setBusy(false);
    if (l) {
      setLinks(l);
      setConfirmingReset(false);
      onChanged();
    } else {
      onFlash(failure);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      onFlash('Calendar link copied.');
    } catch {
      onFlash(`Couldn't copy automatically — the link is ${url}`);
    }
  }

  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop acctdlg"
        role="dialog"
        aria-modal="true"
        aria-label="Calendar subscription"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="planpick__title">Calendar subscription</h2>
        <p className="planpick__sub">
          Pick one plan per term. Your calendar shows the classes, midterms and finals of the plans you pick, and
          drops a term once its finals are over.
        </p>
        {cal === undefined && <p className="planpick__sub">Loading…</p>}
        {cal === null && <p className="planpick__sub">Couldn't load your calendar settings.</p>}
        {cal && (
          <>
            <ul className="calterms">
              {rows.map((r) => {
                const gone = missing.includes(r.key);
                const value = gone ? '' : (picks[r.key] ?? '');
                return (
                  <li key={r.key} className="calterms__row">
                    <label className="calterms__label">
                      <span className="calterms__term">{r.label}</span>
                      <select
                        className="calterms__select"
                        value={value}
                        disabled={busy}
                        onChange={(e) => void choose(r.key, e.target.value)}
                      >
                        <option value="">Not in calendar</option>
                        {r.plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                    {gone && (
                      <p className="calterms__hint">The plan you picked for {r.label} was deleted — pick another.</p>
                    )}
                    {!gone && !value && (
                      <p className="calterms__hint">Pick a plan to add {r.label} to your calendar.</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {saveFailed && <p className="calterms__hint" role="alert">Couldn't save. Please try again.</p>}
            {!links ? (
              <div className="acctdlg__actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={() => void makeLink(createCalendarLink, "Couldn't create the link. Please try again.")}
                >
                  Create my calendar link
                </button>
              </div>
            ) : (
              <div className="calterms__links">
                <div className="acctdlg__actions">
                  <a className="btn btn--sm" href={links.webcal}>Subscribe in Apple Calendar</a>
                  <button type="button" className="btn btn--sm" onClick={() => void copy(links.https)}>
                    Copy link for Google Calendar
                  </button>
                </div>
                <p className="planpick__sub">
                  In Google Calendar on a computer: Other calendars → + → From URL → paste the link → Add calendar.
                </p>
                <p className="planpick__sub">
                  Apple Calendar picks up changes within an hour. Google Calendar can take several hours to a day — it
                  can't be sped up.
                </p>
                {confirmingReset ? (
                  <>
                    <p className="sharedlinks__ask">
                      Your old link stops working right away, and you'll need to subscribe again.
                    </p>
                    <div className="acctdlg__actions">
                      <button type="button" className="btn btn--sm" onClick={() => setConfirmingReset(false)}>
                        Keep
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm acctdlg__danger"
                        disabled={busy}
                        onClick={() => void makeLink(resetCalendarLink, "Couldn't reset the link. Please try again.")}
                      >
                        Reset
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="acctdlg__actions">
                    <button type="button" className="btn btn--sm" onClick={() => setConfirmingReset(true)}>
                      Reset link
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
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

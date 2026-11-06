import { useEffect, useState } from 'react';
import {
  createCalendarLink, fetchCalendar, googleCalendarUrl, resetCalendarLink, saveCalendarTerms, termCalendarLinks,
  type CalendarLinks, type CalendarState,
} from '../lib/cloud/api';
import type { TermsState } from '../lib/terms-state';
import { displayTermLabel, isArchived, termKey } from '../lib/terms';
import { Dialog } from './Dialog';
import { Message } from './Field';
import { MenuSelect, type MenuOption } from './MenuSelect';
import { Calendar, External } from './icons';

export interface CalendarRow { key: string; label: string; plans: { id: string; name: string }[] }

/**
 * The term on screen, which is the one this dialog picks a plan for: switching term in the
 * topbar is how a student reaches another term's pick. A term that is over feeds no calendar.
 */
export function calendarRow(terms: TermsState, now: Date = new Date()): CalendarRow | null {
  const w = terms.terms[terms.activeTermKey];
  if (!w || w.plans.plans.length === 0 || isArchived(w.term, now)) return null;
  return {
    key: termKey(w.term),
    label: displayTermLabel(w.term),
    plans: w.plans.plans.map((p) => ({ id: p.id, name: p.name })),
  };
}

/** The term on screen needs attention when it has no pick, or its pick was deleted. */
export function calendarNeedsPick(row: CalendarRow | null, cal: Pick<CalendarState, 'terms' | 'missing'>): boolean {
  return row !== null && (!cal.terms[row.key] || cal.missing.includes(row.key));
}

const INTRO =
  "Each term is a calendar of its own. It shows the classes, midterms and finals of the plan you pick for it, and empties once the term's finals are over.";

/** Pick the on-screen term's plan and subscribe to the result in Apple or Google Calendar. */
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
  // undefined = loading, null = could not load
  const [cal, setCal] = useState<CalendarState | null | undefined>(undefined);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const row = calendarRow(terms);
  const onScreen = terms.terms[terms.activeTermKey];

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
    // The server replaces the whole map, so send every pick (including other terms').
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

  const gone = row !== null && missing.includes(row.key);
  const feed = links && row ? termCalendarLinks(links, row.key) : null;
  const value = row === null || gone ? '' : (picks[row.key] ?? '');
  const options: MenuOption[] = row
    ? [
        { value: '', label: 'Not in calendar', faint: true },
        ...row.plans.map((p, i) => ({ value: p.id, label: p.name, divider: i === 0 })),
      ]
    : [];

  return (
    <Dialog
      label="Calendar subscription"
      className="caldlg"
      onClose={onClose}
      eyebrow="Calendar subscription"
      title="Your calendar"
      meta={INTRO}
    >
      {cal === undefined && <p className="mappop__hint">Loading…</p>}
      {cal === null && <Message tone="error">Couldn't load your calendar settings.</Message>}
      {cal && (
        <>
          {row ? (
            <div className="caldlg__term">
              <div className={`prow${gone || !value ? ' prow--ask' : ''}`}>
                <span className="prow__label">{row.label}</span>
                <MenuSelect
                  label={`Plan for ${row.label}`}
                  value={value}
                  options={options}
                  align="end"
                  disabled={busy}
                  onChange={(v) => void choose(row.key, v)}
                />
              </div>
              {gone && <p className="prow__ask">The plan you picked for {row.label} was deleted — pick another.</p>}
              {!gone && !value && <p className="prow__ask">Pick a plan to add {row.label} to your calendar.</p>}
            </div>
          ) : (
            onScreen && (
              <p className="mappop__hint">
                {displayTermLabel(onScreen.term)} is over. A term that is over is no longer in calendars.
              </p>
            )
          )}
          {saveFailed && <Message tone="error">Couldn't save. Please try again.</Message>}
          {!links ? (
            <div className="callout">
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={busy}
                onClick={() => void makeLink(createCalendarLink, "Couldn't create the link. Please try again.")}
              >
                Create my calendar link
              </button>
            </div>
          ) : (
            feed && row && (
              <div className="callout">
                <div className="callout__label">Add {row.label} to</div>
                <div className="callout__actions">
                  <a className="btn btn--sm" href={feed.webcal}>
                    <Calendar size={14} /> Apple Calendar
                  </a>
                  <a className="btn btn--sm" href={googleCalendarUrl(feed.webcal)} target="_blank" rel="noopener noreferrer">
                    <Calendar size={14} /> Google Calendar <External size={11} className="callout__ext" />
                  </a>
                </div>
                <p className="callout__hint">
                  Each opens the app to subscribe. Changes show up in Apple Calendar within an hour; Google Calendar can
                  take several hours to a day, and that can't be sped up.
                </p>
              </div>
            )
          )}
          {links &&
            (confirmingReset ? (
              <div className="callout callout--danger">
                <p className="callout__text">Your old links stop working right away, and you'll need to subscribe to each term again.</p>
                <div className="callout__actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    disabled={busy}
                    onClick={() => void makeLink(resetCalendarLink, "Couldn't reset the link. Please try again.")}
                  >
                    Reset
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setConfirmingReset(false)}>
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <div className="mappop__foot">
                {feed && (
                  <p className="mappop__hint">
                    Another app, or Google didn't open?{' '}
                    <button type="button" className="tlink" onClick={() => void copy(feed.https)}>
                      Copy the link
                    </button>{' '}
                    and add it as a calendar from a URL.
                  </p>
                )}
                <p className="mappop__hint">
                  Shared the link by mistake?{' '}
                  <button type="button" className="tlink tlink--danger" onClick={() => setConfirmingReset(true)}>
                    Reset link
                  </button>
                </p>
              </div>
            ))}
        </>
      )}
    </Dialog>
  );
}

import { useRef, useState } from 'react';
import type { Term } from '@triton/shared';
import { useClickAway } from '../hooks/useClickAway';
import { createCalendarLink, fetchCalendar, saveCalendarTerms, type CalendarLinks } from '../lib/cloud/api';
import { pluralize } from '../lib/format';
import { displayTermLabel, termKey } from '../lib/terms';
import { Calendar, ChevronDown, Share } from './icons';

interface Props {
  /** The term on screen; its plans are the ones offered. */
  term: Term;
  plans: { id: string; name: string; count: number }[];
  activeId: string;
  /** A term that is over is not in any calendar. */
  archived: boolean;
  /** Sends unsaved edits now: a plan made a moment ago must be on the server before the calendar names it. */
  flush: () => Promise<void>;
  onFlash: (msg: string) => void;
}

/** Google's "add a calendar by URL", with the feed already filled in. */
export const googleCalendarUrl = (webcal: string): string =>
  `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

const UNREACHABLE = "Couldn't reach your calendar settings. Check your connection and try again.";

/** What step two needs: the plan picked, the account's calendar link, and the term → plan picks it already has. */
interface Picked {
  plan: { id: string; name: string };
  links: CalendarLinks;
  picks: Record<string, string>;
  /** The account had a calendar link before: it is probably in a calendar app already. */
  subscribed: boolean;
}

/**
 * Share ▾ — puts a plan into the student's calendar: first which plan of this term, then which
 * calendar app. Both apps subscribe to the account's one calendar link, which shows one plan per
 * term, so exporting a plan makes it this term's. Picking the plan fetches (or makes) the link, so
 * the app choices are plain links the browser follows inside the click; a webcal:// opened after
 * an await could be refused for want of a user gesture.
 */
export function ShareMenu({ term, plans, activeId, archived, flush, onFlash }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => setOpen(false));
  const key = termKey(term);
  const label = displayTermLabel(term);

  async function pick(plan: { id: string; name: string }) {
    if (busy) return;
    setBusy(true);
    await flush().catch(() => {});
    const cal = await fetchCalendar();
    const links =
      cal === null ? null : cal.https && cal.webcal ? { https: cal.https, webcal: cal.webcal } : await createCalendarLink();
    setBusy(false);
    if (!cal || !links) {
      onFlash(UNREACHABLE);
      return;
    }
    setPicked({ plan, links, picks: cal.terms, subscribed: cal.https !== null });
  }

  /** The server replaces the whole map, so every other term's pick goes along unchanged. */
  function putInCalendar(p: Picked) {
    void saveCalendarTerms({ ...p.picks, [key]: p.plan.id }).then((ok) =>
      onFlash(
        ok ? `Your calendar shows “${p.plan.name}” for ${label}.` : "Couldn't save which plan your calendar shows. Please try again.",
      ),
    );
    // After the click has been followed: the link must still be in the page when the browser acts on it.
    setTimeout(() => setOpen(false));
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) setPicked(null);
          setOpen((v) => !v);
        }}
      >
        <Share size={15} /> Share <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu menu--right" role="menu" aria-busy={busy}>
          {archived ? (
            <p className="menu__foot">{label} is over, so it is no longer in calendars.</p>
          ) : !picked ? (
            <>
              <div className="menu__head eyebrow">Add to calendar · {label} · which plan?</div>
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="menu__item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void pick(p)}
                >
                  <span className="menu__item-title">{p.name}</span>
                  <span className="menu__item-desc">
                    {p.count} {pluralize(p.count, 'course')}
                    {p.id === activeId ? ' · on screen' : ''}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="menu__head eyebrow">
                <button type="button" className="menu__back" onClick={() => setPicked(null)} aria-label="Back to plans">
                  ‹
                </button>
                {picked.plan.name} · which calendar?
              </div>
              <a
                className="menu__item"
                role="menuitem"
                href={picked.links.webcal}
                onClick={() => putInCalendar(picked)}
              >
                <span className="menu__item-title">
                  <Calendar size={14} /> Export to Apple Calendar
                </span>
                <span className="menu__item-desc">Opens Calendar to subscribe. Changes show up within an hour.</span>
              </a>
              <a
                className="menu__item"
                role="menuitem"
                href={googleCalendarUrl(picked.links.webcal)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => putInCalendar(picked)}
              >
                <span className="menu__item-title">
                  <Calendar size={14} /> Export to Google Calendar
                </span>
                <span className="menu__item-desc">
                  Opens Google Calendar to add it. Changes can take several hours to a day to show up.
                </span>
              </a>
              {picked.subscribed && (
                <p className="menu__foot">
                  Already in your calendar?{' '}
                  <button
                    type="button"
                    className="menu__link"
                    onClick={() => putInCalendar(picked)}
                  >
                    Just switch it to this plan
                  </button>{' '}
                  — adding it again would show it twice.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

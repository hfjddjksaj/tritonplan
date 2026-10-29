import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Term } from '@triton/shared';
import { useEscapeKey } from '../hooks/useEscapeKey';
import {
  createCalendarLink, fetchCalendar, googleCalendarUrl, saveCalendarTerms, type CalendarLinks,
} from '../lib/cloud/api';
import { pluralize } from '../lib/format';
import { displayTermLabel, termKey } from '../lib/terms';
import { Calendar, Share, X } from './icons';

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
 * Share — puts a plan into the student's calendar, in a dialog like the building one: first which
 * plan of this term, then which calendar app. Both apps subscribe to the account's one calendar
 * link, which shows one plan per term, so exporting a plan makes it this term's. Picking the plan
 * fetches (or makes) the link, so the app choices are plain links the browser follows inside the
 * click; a webcal:// opened after an await could be refused for want of a user gesture.
 */
export function ShareMenu(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--sm btn--primary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Share size={15} /> Share
      </button>
      {open && <ShareDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ term, plans, activeId, archived, flush, onFlash, onClose }: Props & { onClose: () => void }) {
  useEscapeKey(onClose);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
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
    setTimeout(onClose);
  }

  // Portaled: the top bar is a positioned ancestor, and a fixed overlay inside it would be held to it.
  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop planpick"
        role="dialog"
        aria-modal="true"
        aria-label="Add to calendar"
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Add to calendar</div>
        {archived ? (
          <>
            <div className="mappop__name">{label} is over</div>
            <p className="planpick__sub">A term that is over is no longer in calendars.</p>
          </>
        ) : !picked ? (
          <>
            <div className="mappop__name">Which plan?</div>
            <p className="planpick__sub">Your calendar shows one plan for {label}.</p>
            <div className="planpick__list">
              {plans.map((p) => (
                <button key={p.id} type="button" className="planpick__item" disabled={busy} onClick={() => void pick(p)}>
                  <span className="planpick__name">{p.name}</span>
                  <span className="planpick__count">
                    {p.count} {pluralize(p.count, 'course')}
                    {p.id === activeId ? ' · on screen' : ''}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mappop__name">Which calendar?</div>
            <p className="planpick__sub">
              “{picked.plan.name}” · {label}
            </p>
            <div className="planpick__list">
              <a className="planpick__item sharecal__app" href={picked.links.webcal} onClick={() => putInCalendar(picked)}>
                <span className="sharecal__title">
                  <Calendar size={15} /> Export to Apple Calendar
                </span>
                <span className="sharecal__desc">Opens Calendar to subscribe. Changes show up within an hour.</span>
              </a>
              <a
                className="planpick__item sharecal__app"
                href={googleCalendarUrl(picked.links.webcal)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => putInCalendar(picked)}
              >
                <span className="sharecal__title">
                  <Calendar size={15} /> Export to Google Calendar
                </span>
                <span className="sharecal__desc">
                  Opens Google Calendar to add it. Changes can take several hours to a day to show up.
                </span>
              </a>
            </div>
            {picked.subscribed && (
              <p className="mappop__hint">
                Already in your calendar?{' '}
                <button type="button" className="sharecal__link" onClick={() => putInCalendar(picked)}>
                  Just switch it to this plan
                </button>{' '}
                — adding it again would show it twice.
              </p>
            )}
            <button type="button" className="btn btn--sm planpick__cancel sharecal__back" onClick={() => setPicked(null)}>
              ‹ Back to plans
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

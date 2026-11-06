import { useState } from 'react';
import type { Term } from '@triton/shared';
import {
  createCalendarLink, fetchCalendar, googleCalendarUrl, saveCalendarTerms, termCalendarLinks, type CalendarLinks,
} from '../lib/cloud/api';
import { displayTermLabel, termKey } from '../lib/terms';
import { Dialog } from './Dialog';
import { PlanList } from './PlanList';
import { Calendar, External, Share } from './icons';

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

/** What step two needs: the plan picked, this term's calendar link, and the term → plan picks the account already has. */
interface Picked {
  plan: { id: string; name: string };
  links: CalendarLinks;
  picks: Record<string, string>;
  /** This term already had a plan in the calendar: it is probably in a calendar app already. */
  subscribed: boolean;
}

/**
 * Share — puts a plan into the student's calendar, in a dialog like the building one: first which
 * plan of this term, then which calendar app. Both apps subscribe to this term's own calendar,
 * which shows the one plan picked for it, so exporting a plan makes it this term's. Picking the plan
 * fetches (or makes) the link, so the app choices are plain links the browser follows inside the
 * click; a webcal:// opened after an await could be refused for want of a user gesture.
 */
export function ShareMenu(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--sm btn--primary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Share size={15} /> Calendar
      </button>
      {open && <ShareDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ term, plans, activeId, archived, flush, onFlash, onClose }: Props & { onClose: () => void }) {
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
    setPicked({ plan, links: termCalendarLinks(links, key), picks: cal.terms, subscribed: cal.https !== null && !!cal.terms[key] });
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

  const step = archived
    ? { title: `${label} is over`, meta: 'A term that is over is no longer in calendars.' }
    : !picked
      ? { title: 'Which plan?', meta: `Your calendar shows one plan for ${label}.` }
      : { title: 'Which calendar?', meta: `“${picked.plan.name}” · ${label}` };

  return (
    <Dialog label="Add to calendar" onClose={onClose} busy={busy} eyebrow="Add to calendar" title={step.title} meta={step.meta}>
      {!archived && !picked && (
        <PlanList plans={plans} mark={{ id: activeId, label: 'On screen' }} disabled={busy} onPick={(p) => void pick(p)} />
      )}
      {!archived && picked && (
        <>
          <div className="callout">
            <div className="callout__actions">
              <a className="btn btn--sm" href={picked.links.webcal} onClick={() => putInCalendar(picked)}>
                <Calendar size={14} /> Apple Calendar
              </a>
              <a
                className="btn btn--sm"
                href={googleCalendarUrl(picked.links.webcal)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => putInCalendar(picked)}
              >
                <Calendar size={14} /> Google Calendar <External size={11} className="callout__ext" />
              </a>
            </div>
            <p className="callout__hint">
              Each opens the app to subscribe. Changes show up in Apple Calendar within an hour; Google Calendar can take
              several hours to a day.
            </p>
          </div>
          {picked.subscribed && (
            <div className="mappop__foot">
              <p className="mappop__hint">
                Already in your calendar?{' '}
                <button type="button" className="tlink" onClick={() => putInCalendar(picked)}>
                  Just switch it to this plan
                </button>{' '}
                — adding it again would show it twice.
              </p>
            </div>
          )}
          <div className="mappop__actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPicked(null)}>
              ‹ Back to plans
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

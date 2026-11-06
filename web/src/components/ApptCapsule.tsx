import { useEffect, useState } from 'react';
import type { ApptTimes, Term } from '@triton/shared';
import {
  apptWindowStatus,
  formatApptInstant,
  apptForTerm,
  nextRelevantWindow,
} from '../lib/appt';
import { useIsMobile } from '../hooks/useIsMobile';
import { ApptPopover } from './ApptPopover';
import { Clock } from './icons';
import { tip } from './Tooltip';

interface Props {
  appt: ApptTimes[];
  /** The term being viewed in the planner — the capsule shows only its windows. */
  term: Term;
}

/** Topbar capsule for the viewed term's next enrollment window: "First Pass ·
 *  8/10 2:00 PM PT", gold while a window is open, dimmed once all have ended.
 *  ALWAYS rendered on desktop — with nothing captured for the viewed term it reads "Appointment
 *  times" and its popover explains how to get the data (open the TSS tile
 *  once), so the feature is discoverable. Mobile is the exception: phones
 *  can't run the extension, so a no-data prompt would be a dead end there —
 *  the capsule only shows on mobile when data exists. */
export function ApptCapsule({ appt, term }: Props) {
  const [open, setOpen] = useState(false);
  // Minute tick so upcoming→open→ended flips without a reload (matches the
  // seats-age ticker convention in CourseCard).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const isMobile = useIsMobile();

  const now = new Date();
  const record = apptForTerm(appt, term);
  // A captured-but-windowless record isn't display-worthy, but its popover
  // (term header + "no windows listed yet" + captured-ago) still is.
  const shown = record && record.windows.length > 0 ? record : null;
  if (!shown && isMobile) return null;

  const next = shown ? nextRelevantWindow(shown, now) : null;
  const status = next ? apptWindowStatus(next, now) : 'ended';

  let text: string;
  if (!shown) text = 'Appointment times'; // nothing captured (or none listed) — prompt state
  else if (!next) text = 'Enrollment ended';
  else if (status === 'open') text = isMobile ? 'open now' : `${next.label} · open now`;
  else if (isMobile) text = formatApptInstant(next.beginsAt).split(' ')[0]!; // "8/10"
  else text = `${next.label} · ${formatApptInstant(next.beginsAt)} PT`;

  return (
    <>
      <button
        type="button"
        className={
          'appt-capsule' +
          (shown && status === 'open' ? ' appt-capsule--open' : '') +
          (shown && !next ? ' appt-capsule--ended' : '')
        }
        {...tip('Your enrollment appointment times')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Clock size={13} />
        <span className="appt-capsule__text">{text}</span>
      </button>
      {open && <ApptPopover appt={record} term={term} onClose={() => setOpen(false)} />}
    </>
  );
}

import { useEffect, useState } from 'react';
import type { ApptTimes } from '@triton/shared';
import { apptWindowStatus, formatApptInstant, nextRelevantWindow, pickDisplayTerm } from '../lib/appt';
import { useIsMobile } from '../hooks/useIsMobile';
import { ApptPopover } from './ApptPopover';
import { Clock } from './icons';

interface Props {
  appt: ApptTimes[];
}

/** Topbar capsule for the student's next enrollment window: "First Pass ·
 *  8/10 2:00 PM PT", gold while a window is open, dimmed once all have ended.
 *  Renders NOTHING when no data was ever captured (old extension / tile never
 *  opened / no extension) — zero noise. */
export function ApptCapsule({ appt }: Props) {
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
  const term = pickDisplayTerm(appt, now);
  if (!term) return null;

  const next = nextRelevantWindow(term, now);
  const status = next ? apptWindowStatus(next, now) : 'ended';

  let text: string;
  if (!next) text = 'Enrollment ended';
  else if (status === 'open') text = isMobile ? 'open now' : `${next.label} · open now`;
  else if (isMobile) text = formatApptInstant(next.beginsAt).split(' ')[0]!; // "8/10"
  else text = `${next.label} · ${formatApptInstant(next.beginsAt)} PT`;

  return (
    <>
      <button
        type="button"
        className={
          'appt-capsule' +
          (status === 'open' ? ' appt-capsule--open' : '') +
          (next ? '' : ' appt-capsule--ended')
        }
        title="Your enrollment appointment times"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Clock size={13} />
        <span className="appt-capsule__text">{text}</span>
      </button>
      {open && <ApptPopover appt={term} onClose={() => setOpen(false)} />}
    </>
  );
}

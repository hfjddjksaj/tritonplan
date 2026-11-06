import type { ApptTimes, Term } from '@triton/shared';
import {
  apptWindowStatus,
  deviceZone,
  formatApptInstant,
  formatApptRangeInZone,
  localZoneIfNotPacific,
  type ApptStatus,
} from '../lib/appt';
import { relativeTime } from '../lib/format';
import { openApptTimesInTss } from '../lib/tss';
import { PRODUCT_NAME } from '../lib/brand';
import { displayTermLabel } from '../lib/terms';
import { Dialog } from './Dialog';
import { External } from './icons';

interface Props {
  /** null = nothing captured yet — show the "open TSS once" prompt instead. */
  appt: ApptTimes | null;
  /** The term being viewed — named in the prompt when nothing is captured for it. */
  term: Term;
  onClose: () => void;
}

const STATUS_LABEL: Record<ApptStatus, string> = {
  upcoming: 'Upcoming', open: 'Open now', ended: 'Ended',
};

/** Every enrollment window of the shown term, with live status. Rendered from
 *  passively captured data; refreshing = reopening the TSS tile. */
export function ApptPopover({ appt, term, onClose }: Props) {
  const now = new Date();
  return (
    <Dialog label="Your appointment times" className="apptpop" onClose={onClose} eyebrow="Appointment times">

        {appt === null ? (
          <>
            <p className="apptpop__none">
              Not captured for {displayTermLabel(term)} yet. Open “My Appointment Times” in TSS and pick{' '}
              {displayTermLabel(term)} in its term list — with the {PRODUCT_NAME} extension installed,
              your enrollment windows (First Pass, Second Pass, …) are picked up automatically and
              will show here, kept fresh every time you revisit that page.
            </p>
            <div className="mappop__actions">
              <button type="button" className="btn btn--sm btn--primary" onClick={openApptTimesInTss}>
                <External size={14} /> Open in TSS
              </button>
            </div>
            <p className="mappop__hint">
              Yours only: never part of plans, share links or QR codes.
            </p>
          </>
        ) : (
          <ApptPopoverBody appt={appt} now={now} />
        )}
    </Dialog>
  );
}

/** The captured-data body: term header, per-window cards, freshness footer.
 *  Secondary "your time" line only when the device isn't on Pacific time. */
function ApptPopoverBody({ appt, now }: { appt: ApptTimes; now: Date }) {
  const localZone = localZoneIfNotPacific(deviceZone());
  return (
    <>
      <div className="apptpop__term">{appt.sessionText} {appt.yearText}</div>

      {appt.windows.length === 0 ? (
        <p className="apptpop__none">No enrollment windows listed for this term yet.</p>
      ) : (
        <div className="apptpop__list">
          {appt.windows.map((w, i) => {
            const status = apptWindowStatus(w, now);
            const local = localZone ? formatApptRangeInZone(w.beginsAt, w.endsAt, localZone) : '';
            return (
              <div key={`${w.label}-${w.beginsAt}-${i}`} className={`apptpop__win apptpop__win--${status}`}>
                <div className="apptpop__winhead">
                  <span className="apptpop__label">{w.label}</span>
                  <span className={`apptpop__status apptpop__status--${status}`}>
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                <div className="apptpop__times mono">
                  {formatApptInstant(w.beginsAt)} – {formatApptInstant(w.endsAt)} PT
                </div>
                {local && (
                  <div className="apptpop__times apptpop__times--local mono">
                    Your time: {local}
                  </div>
                )}
                {(w.unitCap || w.waitlists) && (
                  <div className="apptpop__meta">
                    {w.unitCap && <span>Unit cap {w.unitCap}</span>}
                    {w.waitlists && <span>Waitlists: {w.waitlists}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mappop__hint">
        Captured {relativeTime(appt.capturedAt, now) || 'earlier'} — reopen “My Appointment
        Times” in TSS to refresh. Times shown in Pacific Time, as in TSS. Yours only: never
        part of plans, share links or QR codes.
      </p>
    </>
  );
}

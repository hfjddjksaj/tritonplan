import { createPortal } from 'react-dom';
import type { ApptTimes } from '@triton/shared';
import { useEscapeKey } from '../hooks/useEscapeKey';
import {
  apptWindowStatus,
  deviceZone,
  formatApptInstant,
  formatApptRangeInZone,
  localZoneIfNotPacific,
  type ApptStatus,
} from '../lib/appt';
import { relativeTime } from '../lib/format';
import { X } from './icons';

interface Props {
  appt: ApptTimes;
  onClose: () => void;
}

const STATUS_LABEL: Record<ApptStatus, string> = {
  upcoming: 'Upcoming', open: 'Open now', ended: 'Ended',
};

/** Every enrollment window of the shown term, with live status. Rendered from
 *  passively captured data; refreshing = reopening the TSS tile. */
export function ApptPopover({ appt, onClose }: Props) {
  useEscapeKey(onClose);
  const now = new Date();
  // Secondary "your time" line — only when the device isn't on Pacific time.
  const localZone = localZoneIfNotPacific(deviceZone());
  return createPortal(
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className="mappop apptpop"
        role="dialog"
        aria-modal="true"
        aria-label="Your appointment times"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        <div className="eyebrow">Appointment times</div>
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
      </div>
    </div>,
    document.body,
  );
}

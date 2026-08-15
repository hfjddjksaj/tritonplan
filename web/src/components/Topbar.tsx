import type { ReactNode } from 'react';
import type { PlanState } from '@triton/shared';
import { PRODUCT_NAME } from '../lib/brand';
import { ShareMenu } from './ShareMenu';
import { Trident, Trash } from './icons';

interface Props {
  /** The term chip / switcher, rendered after the plan switcher. */
  termSlot: ReactNode;
  units: number;
  /** Viewing someone else's plan — editing actions (Clear) hide. */
  readOnly: boolean;
  /** The named-plans dropdown, rendered next to the brand. */
  planSwitcher?: ReactNode;
  /** The student's own appointment-times capsule, rendered before the unit pill. */
  apptSlot?: ReactNode;
  /** The plan on screen, for the Share menu (link + QR). */
  sharePlan: PlanState;
  onFlash: (msg: string) => void;
  onReset: () => void;
}

export function Topbar({
  termSlot,
  units,
  readOnly,
  planSwitcher,
  apptSlot,
  sharePlan,
  onFlash,
  onReset,
}: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <Trident className="brand__mark" size={22} />
        <span>{PRODUCT_NAME}</span>
        <span className="brand__sub">· UCSD</span>
      </div>

      {planSwitcher}

      {termSlot}

      <div className="topbar__spacer" />

      {apptSlot}

      <div className="unit-pill" title="Total units of added courses">
        <span className="unit-pill__n mono">{units}</span>
        <span className="unit-pill__label">units</span>
      </div>

      <div className="topbar__actions">
        {!readOnly && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={onReset}
            title="Remove every course from the plan"
          >
            <Trash size={15} /> Clear
          </button>
        )}

        <ShareMenu plan={sharePlan} onFlash={onFlash} />
      </div>
    </header>
  );
}

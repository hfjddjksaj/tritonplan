import type { ReactNode } from 'react';
import type { PlanState } from '@triton/shared';
import { PRODUCT_NAME } from '../lib/brand';
import { ShareMenu } from './ShareMenu';
import { Trident, Trash, MapPinIcon } from './icons';
import { tip } from './Tooltip';

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
  /** The signed-in account's menu, rendered at the far right. */
  accountSlot?: ReactNode;
  /** The plan on screen, for the Share menu (link + QR). Null: no menu (signed out, a link needs an account). */
  sharePlan: PlanState | null;
  /** Name the shared link is listed under. */
  planName: string;
  onFlash: (msg: string) => void;
  onReset: () => void;
  onOpenMap: () => void;
}

export function Topbar({
  termSlot,
  units,
  readOnly,
  planSwitcher,
  apptSlot,
  accountSlot,
  sharePlan,
  planName,
  onFlash,
  onReset,
  onOpenMap,
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

      <div className="unit-pill" {...tip('Total units of added courses')}>
        <span className="unit-pill__n mono">{units}</span>
        <span className="unit-pill__label">units</span>
      </div>

      <div className="topbar__actions">
        {!readOnly && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={onReset}
            {...tip('Remove every course from the plan')}
          >
            <Trash size={15} /> Clear
          </button>
        )}

        <button
          type="button"
          className="btn btn--sm"
          onClick={onOpenMap}
          {...tip("See where this term's classes meet on a campus map")}
        >
          <MapPinIcon size={15} /> Map
        </button>

        {sharePlan && <ShareMenu plan={sharePlan} planName={planName} onFlash={onFlash} />}
      </div>

      {accountSlot}
    </header>
  );
}

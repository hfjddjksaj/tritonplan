/**
 * The top bar of a shared plan's page. Violet edge to edge where the student's own planner is
 * white and gold, so a friend's plan is never taken for theirs. Nothing on it belongs to an
 * account (plans, terms, Clear, calendar, the account menu): only what this one plan offers.
 */
import type { Term } from '@triton/shared';
import { expiryText } from '../../lib/format';
import { displayTermLabel } from '../../lib/terms';
import { Download, Link, MapPinIcon, Swap } from '../icons';
import { tip } from '../Tooltip';

interface Props {
  term: Term;
  units: number;
  expiresAt: string;
  onOpenMap: () => void;
  onCopyLink: () => void;
  onSave: () => void;
}

export function SharedTopbar({ term, units, expiresAt, onOpenMap, onCopyLink, onSave }: Props) {
  return (
    <header className="topbar topbar--shared">
      <div className="sharedbar__id">
        <div className="sharedbar__brand">
          <Swap size={18} className="sharedbar__mark" aria-hidden="true" />
          <span>Shared plan</span>
        </div>
        <div className="sharedbar__meta">
          <span className="sharedbar__term">{displayTermLabel(term)}</span>
          <span
            className="sharedbar__live"
            {...tip('Anyone with the link can switch sections, and everyone who has it open sees the change')}
          >
            <span className="sharedbar__dot" aria-hidden="true" />
            <span className="sharedbar__expiry">
              <span className="sharedbar__live-word">Live · </span>
              {expiryText(expiresAt)}
            </span>
          </span>
        </div>
      </div>

      <div className="topbar__spacer" />

      <div className="unit-pill" {...tip('Total units of the courses in this plan')}>
        <span className="unit-pill__n mono">{units}</span>
        <span className="unit-pill__label">units</span>
      </div>

      {/* Labelled by aria-label too: on a phone each shows only its icon. */}
      <div className="topbar__actions">
        <button
          type="button"
          className="btn btn--sm topbar__map"
          aria-label="Map"
          onClick={onOpenMap}
          {...tip("See where this plan's classes meet on a campus map")}
        >
          <MapPinIcon size={15} /> Map
        </button>
        <button
          type="button"
          className="btn btn--sm sharedbar__copy"
          aria-label="Copy link"
          onClick={onCopyLink}
          {...tip('Copy the link to this shared plan')}
        >
          <Link size={15} /> Copy link
        </button>
        <button
          type="button"
          className="btn btn--sm sharedbar__save"
          aria-label="Save to my plans"
          onClick={onSave}
          {...tip('Save courses from this plan into your own plans')}
        >
          <Download size={15} /> Save to my plans
        </button>
      </div>
    </header>
  );
}

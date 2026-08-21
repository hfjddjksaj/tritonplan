import type { ReceivedPlan } from '../lib/storage';
import { Eye, X, Check } from './icons';
import { tip } from './Tooltip';

interface Props {
  received: ReceivedPlan;
  viewing: 'mine' | 'received';
  onView: () => void;
  onBackToMine: () => void;
  /** Keep it as a NEW named plan (e.g. "朋友的plan") — the safe default. */
  onSaveAsNew: () => void;
  /** Overwrite the currently active plan with it (confirmed by the caller). */
  onSaveAsMine: () => void;
  onDiscard: () => void;
}

/**
 * Always-visible reminder while a received plan (share link / imported JSON)
 * is around: it is NOT the user's own plan, it's read-only, and the user can
 * hop between it and their own plan at any time.
 */
export function ReceivedBanner({
  received,
  viewing,
  onView,
  onBackToMine,
  onSaveAsNew,
  onSaveAsMine,
  onDiscard,
}: Props) {
  const noun = received.source === 'link' ? 'shared plan' : 'imported plan';

  if (viewing === 'received') {
    return (
      <div className="received received--active" role="status">
        <span className="received__label">
          <Eye size={14} /> Viewing a {noun}
        </span>
        <span className="received__text">
          This is not your plan — it’s read-only and kept separate from your own.
        </span>
        <span className="received__spacer" />
        <div className="received__actions">
          <button type="button" className="btn btn--sm" onClick={onBackToMine}>
            Back to my plans
          </button>
          <button type="button" className="btn btn--sm" onClick={onSaveAsMine}>
            Replace current plan
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={onSaveAsNew}>
            <Check size={13} /> Save as a new plan
          </button>
        </div>
        <button
          type="button"
          className="received__discard"
          onClick={onDiscard}
          aria-label={`Discard this ${noun}`}
          {...tip(`Discard this ${noun}`)}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="received" role="status">
      <span className="received__text">
        A {noun} is saved alongside your plan.
      </span>
      <span className="received__spacer" />
      <button type="button" className="btn btn--sm" onClick={onView}>
        <Eye size={13} /> View it
      </button>
      <button
        type="button"
        className="received__discard"
        onClick={onDiscard}
        aria-label={`Discard the ${noun}`}
        {...tip(`Discard the ${noun}`)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

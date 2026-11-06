import type { Term } from '@triton/shared';
import { Calendar } from './icons';
import { SEASON_NAMES, displayTermLabel, seasonOf } from '../lib/terms';

/**
 * Status bar under the top bar, in the guest banner's look: the next term's enrollment
 * is open and the student has no workspace for it yet; one button creates it.
 */
export function TermOpenBanner({ term, activeLabel, onCreate }: { term: Term; activeLabel: string; onCreate: () => void }) {
  const label = displayTermLabel(term);
  const season = seasonOf(term);
  return (
    <div className="received received--active" role="status">
      <span className="received__label">
        <Calendar size={14} /> {label} enrollment is open
      </span>
      <span className="received__text">
        Start a {season ? SEASON_NAMES[season] : label} plan to add classes from TSS. Your {activeLabel} plan stays as it is.
      </span>
      <span className="received__spacer" />
      <button type="button" className="btn btn--sm btn--primary" onClick={onCreate}>
        Create {label}
      </button>
    </div>
  );
}

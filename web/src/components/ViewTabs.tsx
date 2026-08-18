import { Calendar, Cap, PenLine } from './icons';

/** The three ways of looking at a plan — the calendar's tabs and, later, the map's. */
export type PlannerView = 'calendar' | 'midterms' | 'finals';

interface Props {
  value: PlannerView;
  onChange: (v: PlannerView) => void;
  /** The first tab reads "Calendar" on the planner and "Classes" on the map. */
  calendarLabel?: string;
  /** Ids rendered but not selectable; the tab gets `disabled` and a "Coming soon" title. Currently unused in production. */
  disabled?: readonly PlannerView[];
  /** Finals-conflict count; the badge shows only when > 0. */
  finalsBadge?: number;
  ariaLabel?: string;
}

/**
 * The segmented Calendar / Midterms / Finals control. One component for both
 * the planner toolbar and the campus map, so the two stay one control.
 */
export function ViewTabs({
  value,
  onChange,
  calendarLabel = 'Calendar',
  disabled = [],
  finalsBadge = 0,
  ariaLabel = 'Planner views',
}: Props) {
  const tab = (id: PlannerView, label: string, icon: JSX.Element, badge?: number) => {
    const off = disabled.includes(id);
    return (
      <button
        type="button"
        role="tab"
        aria-selected={value === id}
        className={`tab${value === id ? ' tab--active' : ''}`}
        disabled={off}
        title={off ? 'Coming soon' : undefined}
        onClick={() => {
          if (!off) onChange(id);
        }}
      >
        {icon}
        {label}
        {badge !== undefined && badge > 0 && <span className="tab__badge">{badge}</span>}
      </button>
    );
  };
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tab('calendar', calendarLabel, <Calendar size={15} />)}
      {tab('midterms', 'Midterms', <PenLine size={15} />)}
      {tab('finals', 'Finals', <Cap size={15} />, finalsBadge)}
    </div>
  );
}

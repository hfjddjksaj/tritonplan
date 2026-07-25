import { Calendar, Cap, List } from './icons';

export type MobileTab = 'courses' | 'calendar' | 'finals';

interface Props {
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
  coursesCount: number;
  finalsBadge: number;
  /** Gold pulse on the Calendar tab after the plan changed from another tab. */
  pulse: boolean;
}

export function MobileTabBar({ tab, onTab, coursesCount, finalsBadge, pulse }: Props) {
  const item = (
    id: MobileTab,
    label: string,
    icon: JSX.Element,
    badge?: number,
    badgeClass = '',
    extra = '',
  ) => (
    <button
      type="button"
      className={`tabbar__btn${tab === id ? ' tabbar__btn--active' : ''}${extra}`}
      aria-current={tab === id ? 'page' : undefined}
      onClick={() => onTab(id)}
    >
      <span className="tabbar__icon">
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className={`tab__badge tabbar__badge${badgeClass}`}>{badge}</span>
        )}
      </span>
      {label}
    </button>
  );
  return (
    <nav className="tabbar" aria-label="Planner sections">
      {item('courses', 'Courses', <List size={18} />, coursesCount, ' tabbar__badge--count')}
      {item(
        'calendar',
        'Calendar',
        <Calendar size={18} />,
        undefined,
        '',
        pulse ? ' tabbar__btn--pulse' : '',
      )}
      {item('finals', 'Finals', <Cap size={18} />, finalsBadge)}
    </nav>
  );
}

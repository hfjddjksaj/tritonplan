import { colorsForHue } from '../lib/colors';
import type { UnscheduledItem } from '../lib/plan';

export function UnscheduledList({ items }: { items: UnscheduledItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="unsched">
      <div className="rail__section">
        <span className="eyebrow">Unscheduled / TBA</span>
      </div>
      {items.map((it, i) => {
        const c = colorsForHue(it.hue);
        return (
          <div
            key={`${it.courseId}-${it.sectionCode}-${i}`}
            className="unsched__item"
            style={{ borderLeft: `3px solid ${c.spine}` }}
          >
            <span className="unsched__code">{it.courseCode}</span>
            <span className="unsched__type">{it.typeText}</span>
            <span className="unsched__tba">{it.sectionCode}</span>
          </div>
        );
      })}
    </div>
  );
}

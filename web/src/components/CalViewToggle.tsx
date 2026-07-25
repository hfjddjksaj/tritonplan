import type { CalView } from '../lib/storage';

interface Props {
  value: CalView;
  onChange: (v: CalView) => void;
}

/** Mobile calendar layout switch: whole week squeezed in vs wide scrolling days. */
export function CalViewToggle({ value, onChange }: Props) {
  const btn = (v: CalView, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      className={`calseg__btn${value === v ? ' calseg__btn--on' : ''}`}
      onClick={() => onChange(v)}
    >
      {label}
    </button>
  );
  return (
    <div className="calseg" role="radiogroup" aria-label="Calendar layout">
      {btn('fit', 'Week')}
      {btn('scroll', 'Days')}
    </div>
  );
}

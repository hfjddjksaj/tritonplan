/** The topbar term chip, upgraded to a switcher: anchored panel with one row
 *  per academic year (Fall | Winter | Spring), a bold divider, then Summer
 *  rows. Grey placeholder cells are not clickable (spec §5). */
import { useRef, useState } from 'react';
import type { Term } from '@triton/shared';
import { buildSwitcherRows, type SwitcherCell, type TermKey } from '../lib/terms';
import { useClickAway } from '../hooks/useClickAway';
import { ChevronDown } from './icons';

interface Props {
  terms: Term[];
  activeKey: TermKey;
  activeLabel: string;
  archived: boolean;
  onSwitch: (key: TermKey) => void;
}

function Cell({ cell, onPick }: { cell: SwitcherCell; onPick: (key: TermKey) => void }) {
  if (!cell.selectable || cell.key === null) {
    return <span className="termsw__cell termsw__cell--placeholder">{cell.label}</span>;
  }
  return (
    <button
      type="button"
      className={`termsw__cell${cell.current ? ' termsw__cell--current' : ''}${cell.archived ? ' termsw__cell--archived' : ''}`}
      onClick={() => onPick(cell.key!)}
    >
      {cell.label}
      {cell.archived && <span className="termsw__tag">archived</span>}
    </button>
  );
}

export function TermSwitcher({ terms, activeKey, activeLabel, archived, onSwitch }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => setOpen(false));
  const rows = buildSwitcherRows(terms, activeKey, new Date());

  const pick = (key: TermKey) => {
    setOpen(false);
    onSwitch(key);
  };

  return (
    <div className="termsw" ref={ref}>
      <button
        type="button"
        className="topbar__term termsw__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="eyebrow">Term</span>
        <span className="topbar__term-label">
          {activeLabel}
          {archived && <span className="termsw__tag">archived</span>}
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <div className="termsw__panel" role="menu">
          {rows.quarterRows.map((row, i) => (
            <div className="termsw__row" key={`q${i}`}>
              {row.map((cell, j) => (
                <Cell cell={cell} onPick={pick} key={j} />
              ))}
            </div>
          ))}
          {rows.summerRows.length > 0 && <div className="termsw__divider" />}
          {rows.summerRows.map((row, i) => (
            <div className="termsw__row termsw__row--summer" key={`s${i}`}>
              {row.map((cell, j) => (
                <Cell cell={cell} onPick={pick} key={j} />
              ))}
            </div>
          ))}
          {rows.otherRows.map((cell) => (
            <div className="termsw__row termsw__row--other" key={cell.key ?? cell.label}>
              <Cell cell={cell} onPick={pick} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

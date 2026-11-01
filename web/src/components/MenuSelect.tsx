/**
 * Every "pick one from a list" in the planner. Never a native <select>: its popup
 * is drawn by the OS (system font, blue highlight, a wheel on phones) and looks
 * like nothing else here. This is the topbar plan menu's panel and rows instead —
 * a gold-ink check on the chosen row, an optional icon or colour swatch, a mono
 * count on the right — opened from a button that shows the current choice.
 *
 * The list is portaled to <body> with fixed coordinates, so a scrolling dialog or
 * the campus map's island can't clip it. Keyboard: ↓/↑/Enter/Space open it; inside,
 * ↓/↑/Home/End move, Enter/Space pick, Escape/Tab close. Escape stops here: it must
 * close the list, not the dialog or map the list sits in.
 */
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from './icons';

export interface MenuOption {
  value: string;
  label: string;
  /** A 13px icon before the label. */
  icon?: ReactNode;
  /** A colour swatch before the label (a course's colour). */
  swatch?: string;
  /** Mono, right-aligned. */
  count?: ReactNode;
  disabled?: boolean;
  /** Set in the faint ink: the "none" choice (not in calendar, no place). */
  faint?: boolean;
  /** A hairline above this option, between groups. */
  divider?: boolean;
}

interface Props {
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
  /** The control's accessible name. */
  label: string;
  /** Shown when no option has `value`. */
  placeholder?: string;
  disabled?: boolean;
  /** Stretch the button to its row (the map's Distance ends); otherwise it sizes to its text. */
  fill?: boolean;
  /** Which edge the list lines up with. */
  align?: 'start' | 'end';
  id?: string;
}

const GAP = 6;
const EDGE = 8;
const MIN_WIDTH = 200;

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export function MenuSelect({
  value, options, onChange, label, placeholder, disabled, fill = false, align = 'start', id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = options.find((o) => o.value === value);
  const shown = current?.label ?? placeholder ?? '';
  const empty = !current || current.faint === true;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const measure = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, MIN_WIDTH), vw - EDGE * 2);
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    // Open downward unless the list would get cramped there and there is more room above.
    setPlace(
      below >= 180 || below >= above
        ? { left, width, top: r.bottom + GAP, maxHeight: Math.max(below, 120) }
        : { left, width, bottom: vh - r.top + GAP, maxHeight: above },
    );
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  // On open, focus the chosen row (or the first that can be picked).
  useEffect(() => {
    if (!open) return;
    const rows = enabledRows(listRef.current);
    (rows.find((b) => b.getAttribute('aria-selected') === 'true') ?? rows[0])?.focus();
  }, [open]);

  // A press anywhere but the button or the list closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (o: MenuOption) => {
    if (o.disabled) return;
    close(true);
    if (o.value !== value) onChange(o.value);
  };

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close(true);
    }
  };

  const onListKey = (e: ReactKeyboardEvent) => {
    const rows = enabledRows(listRef.current);
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(at + 1); break;
      case 'ArrowUp': e.preventDefault(); go(at - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(rows.length - 1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
      case 'Tab': e.preventDefault(); close(true); break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`msel${fill ? ' msel--fill' : ''}${empty ? ' msel--empty' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        data-value={value}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        {current?.swatch && <span className="menu__swatch" style={{ background: current.swatch }} aria-hidden="true" />}
        {current?.icon && <span className="menu__icon" aria-hidden="true">{current.icon}</span>}
        <span className="msel__text">{shown}</span>
        <ChevronDown size={12} strokeWidth={2.2} className="msel__chev" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            className="menu msel__list"
            role="listbox"
            aria-label={label}
            style={place ? { position: 'fixed', ...place } : { position: 'fixed', visibility: 'hidden' }}
            onKeyDown={onListKey}
          >
            {options.map((o) => (
              <div key={o.value} className="msel__item">
                {o.divider && <div className="menu__div" role="separator" />}
                <button
                  type="button"
                  role="option"
                  className={`menu__row${o.faint ? ' menu__row--faint' : ''}`}
                  aria-selected={o.value === value}
                  data-value={o.value}
                  disabled={o.disabled}
                  tabIndex={-1}
                  onClick={() => pick(o)}
                >
                  <span className="menu__check" aria-hidden="true">
                    {o.value === value && <Check size={13} strokeWidth={2.6} />}
                  </span>
                  {o.swatch && <span className="menu__swatch" style={{ background: o.swatch }} aria-hidden="true" />}
                  {o.icon && <span className="menu__icon" aria-hidden="true">{o.icon}</span>}
                  <span className="menu__label">{o.label}</span>
                  {o.count != null && <span className="menu__count mono">{o.count}</span>}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function enabledRows(list: HTMLElement | null): HTMLButtonElement[] {
  return list ? [...list.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')] : [];
}

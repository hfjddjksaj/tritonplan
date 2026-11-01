/**
 * The planner's one modal shell. Every dialog — the building, requirements,
 * enrolled-section and appointment popovers, the phone's block sheet, Share,
 * the calendar, the account dialogs, the ratings, the plan picker — is this:
 * a dimmed backdrop, the `mappop` card, × top-right, Escape and a click on
 * the backdrop close it, then an optional eyebrow / title / meta stack, then
 * whatever the dialog is for. A dialog brings content, never a shell of its own.
 */
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { X } from './icons';

/** A course's own colours, for a dialog about one course: its code in the title, its dots. */
export interface DialogAccent {
  text: string;
  spine: string;
}

interface Props {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** Extra class on the card, for the dialog's own width or content rules. */
  className?: string;
  accent?: DialogAccent;
  eyebrow?: ReactNode;
  /** 18px/800, in the accent's text colour when there is one. */
  title?: ReactNode;
  /** One short muted paragraph under the title. */
  meta?: ReactNode;
  busy?: boolean;
  /**
   * Portaled to <body> by default: the topbar and the course rail are positioned or
   * clipping ancestors. The campus map renders its building popover in place instead,
   * because the map is itself a fixed layer above the page's dialogs.
   */
  inline?: boolean;
  children?: ReactNode;
}

export function Dialog({
  label, onClose, className, accent, eyebrow, title, meta, busy, inline = false, children,
}: Props) {
  useEscapeKey(onClose);
  const style = accent
    ? ({ '--c-text': accent.text, '--c-spine': accent.spine } as CSSProperties)
    : undefined;
  const shell = (
    <div className="mappop__backdrop" onClick={onClose}>
      <div
        className={className ? `mappop ${className}` : 'mappop'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-busy={busy || undefined}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mappop__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <div className="mappop__name">{title}</div>}
        {meta && <p className="mappop__meta">{meta}</p>}
        {children}
      </div>
    </div>
  );
  return inline ? shell : createPortal(shell, document.body);
}

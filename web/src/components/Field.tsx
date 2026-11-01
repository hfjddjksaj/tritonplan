/**
 * The planner's one text field and one inline message — sign-in, the emailed-link
 * screens, change password, delete account. The field is the rail's filter box:
 * recessed fill, gold border and a soft gold ring on focus, under a caps label.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field({ label, ...input }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="field__input" required {...input} />
    </label>
  );
}

/** A server answer or notice. Errors interrupt (alert); notices don't. */
export function Message({ tone, children }: { tone: 'notice' | 'error'; children: ReactNode }) {
  return (
    <p className={`msg msg--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

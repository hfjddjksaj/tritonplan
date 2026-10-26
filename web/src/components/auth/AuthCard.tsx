/** The frame every signed-out screen shares: brand, heading, then the screen's own content. */
import type { InputHTMLAttributes, ReactNode } from 'react';
import { PRODUCT_NAME } from '../../lib/brand';
import { Trident } from '../icons';

export function AuthCard({ heading, children }: { heading: string; children?: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__card">
        <div className="brand auth__brand">
          <Trident className="brand__mark" size={22} />
          <span>{PRODUCT_NAME}</span>
        </div>
        <h1 className="auth__title">{heading}</h1>
        {children}
      </div>
    </main>
  );
}

export function AuthField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="auth__field">
      <span className="auth__label">{label}</span>
      <input className="auth__input" required {...input} />
    </label>
  );
}

/** A server answer or notice under the heading. Errors interrupt (alert); notices don't. */
export function AuthMessage({ tone, children }: { tone: 'notice' | 'error'; children: ReactNode }) {
  return (
    <p className={`auth__msg auth__msg--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

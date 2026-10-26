import { useRef, useState } from 'react';
import { apiPost, type Me } from '../lib/cloud/api';
import { nav } from '../lib/nav';
import { clearReceived } from '../lib/storage';
import { useClickAway } from '../hooks/useClickAway';
import { ChevronDown } from './icons';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { failureText } from './auth/copy';

type Dialog = 'password' | 'delete' | null;

export function AccountMenu({ me: initial, onFlash }: { me: Me; onFlash: (msg: string) => void }) {
  // Local copy: disconnecting Google changes what the menu may offer, and the
  // boot's `me` is only read once per page.
  const [me, setMe] = useState(initial);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => setOpen(false));

  const choose = (fn: () => void | Promise<void>) => () => {
    setOpen(false);
    void fn();
  };

  async function setPassword() {
    const r = await apiPost('/api/account/password-link', {});
    onFlash(r.ok ? 'We emailed you a link to set a password.' : failureText(r));
  }

  async function disconnectGoogle() {
    const r = await apiPost('/api/account/google/unlink', {});
    if (r.ok) {
      setMe((m) => ({ ...m, hasGoogle: false }));
      onFlash('Google is disconnected from your account.');
    } else {
      onFlash(failureText(r, r.error === 'needs_password' ? { 400: 'Set a password first, so you can still sign in.' } : {}));
    }
  }

  async function signOut() {
    await apiPost('/api/auth/logout', {}); // a failed logout still leaves: the next load re-checks the session
    clearReceived(); // someone else's plan must not greet the next person on this browser
    nav.assign('/');
  }

  return (
    <>
      <div className="menu-wrap" ref={ref}>
        <button
          type="button"
          className="btn btn--sm acctbtn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="acctbtn__initial" aria-hidden="true">
            {me.email.charAt(0).toUpperCase()}
          </span>
          <ChevronDown size={12} />
        </button>
        {open && (
          <div className="menu menu--right acctmenu" role="menu">
            <div className="acctmenu__email">{me.email}</div>
            {me.hasPassword ? (
              <MenuButton onClick={choose(() => setDialog('password'))}>Change password</MenuButton>
            ) : (
              <MenuButton onClick={choose(setPassword)}>Set a password</MenuButton>
            )}
            {me.hasGoogle && me.hasPassword && (
              <MenuButton onClick={choose(disconnectGoogle)}>Disconnect Google</MenuButton>
            )}
            <MenuButton onClick={choose(() => setDialog('delete'))}>Delete account…</MenuButton>
            <MenuButton onClick={choose(signOut)}>Sign out</MenuButton>
          </div>
        )}
      </div>
      {dialog === 'password' && (
        <ChangePasswordDialog me={me} onClose={() => setDialog(null)} onFlash={onFlash} />
      )}
      {dialog === 'delete' && <DeleteAccountDialog me={me} onClose={() => setDialog(null)} />}
    </>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="menu__item acctmenu__item" role="menuitem" onClick={onClick}>
      {children}
    </button>
  );
}

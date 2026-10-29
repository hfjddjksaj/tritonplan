import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiPost, fetchCalendar, type CalendarState, type Me } from '../lib/cloud/api';
import { nav } from '../lib/nav';
import { clearPendingMigration } from '../lib/migration';
import { clearReceived } from '../lib/storage';
import { useClickAway } from '../hooks/useClickAway';
import { ChevronDown } from './icons';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { CalendarDialog, calendarNeedsPick, calendarRows } from './CalendarDialog';
import type { TermsState } from '../lib/terms-state';
import { failureText } from './auth/copy';

type Dialog = 'password' | 'calendar' | 'delete' | null;

/** How long leaving the planner (sign-out, import) waits for unsaved edits to reach the account before going anyway. */
const LEAVE_SAVE_MS = 3000;

export function AccountMenu({
  me: initial,
  terms,
  onFlash,
  flush,
}: {
  me: Me;
  /** The student's plans, so the calendar item can tell when a term still needs a pick. */
  terms: TermsState;
  onFlash: (msg: string) => void;
  /** Sends unsaved edits now (the sync engine's flush). */
  flush: () => Promise<void>;
}) {
  // Local copy: disconnecting Google changes what the menu may offer, and the
  // boot's `me` is only read once per page.
  const [me, setMe] = useState(initial);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cal, setCal] = useState<CalendarState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(open, ref, () => setOpen(false));

  // On mount, on opening the menu (Share may have changed a pick) and after the dialog saves; never per render.
  const liveRef = useRef(true);
  const refreshCalendar = useCallback(async () => {
    const c = await fetchCalendar();
    if (c && liveRef.current) setCal(c);
  }, []);
  useEffect(() => {
    liveRef.current = true;
    void refreshCalendar();
    return () => { liveRef.current = false; };
  }, [refreshCalendar]);
  // Only subscribers get nudged: someone who never made a link has no calendar to keep current.
  const calendarDot = cal !== null && cal.https !== null && calendarNeedsPick(calendarRows(terms), cal);

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

  /** An edit still inside the save debounce would otherwise be lost as the page leaves. Bounded: an unreachable server must not keep the student here. */
  const saveBeforeLeaving = () =>
    Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, LEAVE_SAVE_MS))]);

  /** The file the old site's move page offers when its hand-off fails; /migrate takes it. */
  async function importBackup() {
    await saveBeforeLeaving();
    nav.assign('/migrate');
  }

  async function signOut() {
    // After logout an unsaved edit would go out and be refused.
    await saveBeforeLeaving();
    await apiPost('/api/auth/logout', {}); // a failed logout still leaves: the next load re-checks the session
    clearPendingMigration(); // the old site's plans are this student's, not the next person's on a shared browser
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
          onClick={() => {
            if (!open) void refreshCalendar();
            setOpen((v) => !v);
          }}
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
            <MenuButton onClick={choose(() => setDialog('calendar'))}>
              Calendar subscription
              {calendarDot && <span className="acctmenu__dot" aria-label="needs attention" />}
            </MenuButton>
            <MenuButton onClick={choose(importBackup)}>Import from old TritonPlan</MenuButton>
            <MenuButton onClick={choose(() => setDialog('delete'))}>Delete account…</MenuButton>
            <MenuButton onClick={choose(signOut)}>Sign out</MenuButton>
          </div>
        )}
      </div>
      {dialog === 'password' && (
        <ChangePasswordDialog onClose={() => setDialog(null)} onFlash={onFlash} />
      )}
      {dialog === 'calendar' && (
        <CalendarDialog
          terms={terms}
          onClose={() => setDialog(null)}
          onFlash={onFlash}
          onChanged={() => void refreshCalendar()}
        />
      )}
      {dialog === 'delete' &&<DeleteAccountDialog me={me} onClose={() => setDialog(null)} />}
    </>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="menu__item acctmenu__item" role="menuitem" onClick={onClick}>
      {children}
    </button>
  );
}

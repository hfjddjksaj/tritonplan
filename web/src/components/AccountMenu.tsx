import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiPost, fetchCalendar, type CalendarState, type Me } from '../lib/cloud/api';
import { nav } from '../lib/nav';
import { clearPendingMigration } from '../lib/migration';
import { useClickAway } from '../hooks/useClickAway';
import { BUG_REPORT_URL } from '../lib/brand';
import { Bug, Calendar, ChevronDown, Download, External, Key, Link, SignOut, Trash, Unlink } from './icons';
import { ShareFriendsDialog, type SharablePlan } from './share/ShareFriendsDialog';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { CalendarDialog, calendarNeedsPick, calendarRow } from './CalendarDialog';
import type { TermsState } from '../lib/terms-state';
import { failureText } from './auth/copy';

type Dialog = 'password' | 'calendar' | 'share' | 'delete' | null;

/** How long leaving the planner (sign-out, import) waits for unsaved edits to reach the account before going anyway. */
const LEAVE_SAVE_MS = 3000;

export function AccountMenu({
  me: initial,
  terms,
  sharePlans,
  onFlash,
  flush,
}: {
  me: Me;
  /** The student's plans, so the calendar item can tell when a term still needs a pick. */
  terms: TermsState;
  /** The plans of the term on screen, which New share offers. */
  sharePlans: SharablePlan[];
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
  // The dialog picks for the term on screen, so the dot speaks for that term too.
  const calendarDot = cal !== null && cal.https !== null && calendarNeedsPick(calendarRow(terms), cal);

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
            <div className="menu__head">
              <span className="acctbtn__initial" aria-hidden="true">
                {me.email.charAt(0).toUpperCase()}
              </span>
              <span className="menu__headtext">
                <span className="eyebrow">Signed in as</span>
                <span className="menu__email">{me.email}</span>
              </span>
            </div>
            <div className="menu__div" role="separator" />
            <MenuRow icon={<Calendar size={13} />} onClick={choose(() => setDialog('calendar'))}>
              Calendar subscription
              {calendarDot && <span className="menu__dot" aria-label="needs attention" />}
            </MenuRow>
            <MenuRow icon={<Link size={13} />} onClick={choose(() => setDialog('share'))}>
              Share with friends
            </MenuRow>
            <div className="menu__div" role="separator" />
            <MenuRow icon={<Download size={13} />} onClick={choose(importBackup)}>
              Import from old TritonPlan
            </MenuRow>
            <MenuRow icon={<Bug size={13} />} href={BUG_REPORT_URL} onClick={() => setOpen(false)}>
              Report a bug
            </MenuRow>
            <div className="menu__div" role="separator" />
            {me.hasPassword ? (
              <MenuRow icon={<Key size={13} />} onClick={choose(() => setDialog('password'))}>
                Change password
              </MenuRow>
            ) : (
              <MenuRow icon={<Key size={13} />} onClick={choose(setPassword)}>
                Set a password
              </MenuRow>
            )}
            {me.hasGoogle && me.hasPassword && (
              <MenuRow icon={<Unlink size={13} />} onClick={choose(disconnectGoogle)}>
                Disconnect Google
              </MenuRow>
            )}
            <MenuRow icon={<SignOut size={13} />} onClick={choose(signOut)}>
              Sign out
            </MenuRow>
            <MenuRow icon={<Trash size={13} />} danger onClick={choose(() => setDialog('delete'))}>
              Delete account…
            </MenuRow>
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
      {dialog === 'share' && (
        <ShareFriendsDialog plans={sharePlans} onClose={() => setDialog(null)} onCopied={onFlash} />
      )}
      {dialog === 'delete' && <DeleteAccountDialog me={me} onClose={() => setDialog(null)} />}
    </>
  );
}

/** One row of the menu: a button, or with `href` a link that leaves the site in a new tab (marked ↗). */
function MenuRow({
  icon,
  danger = false,
  href,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  /** A real link, so middle-click and "copy link" work; the click handler then only closes the menu. */
  href?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const className = `menu__row${danger ? ' menu__row--danger' : ''}`;
  const body = (
    <>
      <span className="menu__icon" aria-hidden="true">{icon}</span>
      <span className="menu__label">{children}</span>
    </>
  );
  if (href) {
    return (
      <a className={className} role="menuitem" href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {body}
        <span className="menu__icon" aria-hidden="true"><External size={11} /></span>
      </a>
    );
  }
  return (
    <button type="button" className={className} role="menuitem" onClick={onClick}>
      {body}
    </button>
  );
}

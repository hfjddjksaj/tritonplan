/**
 * The sign-in gate. Nothing of the planner mounts until the account and its
 * state have loaded, so a signed-out visitor never sees it and an extension
 * push waits in the bridge hub until usePlan subscribes. Emailed links
 * (/reset, /verify) are handled first: they work signed out. So does someone's
 * shared plan (/s/<code>, or an old #p= link), read-only until they sign in.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanState } from '@triton/shared';
import App from './App';
import { AuthCard } from './components/auth/AuthCard';
import { AUTH_NOTICES } from './components/auth/copy';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/auth/LoginScreen';
import { ImportConfirm, type ImportOutcome } from './components/migrate/ImportConfirm';
import { MigrateReceiver } from './components/migrate/MigrateReceiver';
import { ResetPasswordScreen } from './components/auth/ResetPasswordScreen';
import { VerifyScreen } from './components/auth/VerifyScreen';
import { ShareGone } from './components/share/ShareGone';
import { SharedPlanView } from './components/share/SharedPlanView';
import { fetchMe, fetchShare, fetchState, UnauthorizedError, type Me } from './lib/cloud/api';
import {
  carriesPlan,
  clearPendingShare,
  dropPendingHash,
  makeBoot,
  peekPendingShare,
  restorePendingHash,
  stashPendingHash,
  stashPendingSave,
  stashPendingShare,
  takePendingSave,
  type AdoptPlan,
  type CloudBoot,
} from './lib/cloud/boot';
import { pluralize } from './lib/format';
import type { WebSnapshot } from './lib/cloud/records';
import { loadPendingMigration, type MigrationPayload } from './lib/migration';
import { planFromHash } from './lib/share';
import { saveReceived, saveViewing } from './lib/storage';

type Entry =
  | { kind: 'reset'; token: string }
  | { kind: 'verify'; token: string }
  | { kind: 'migrate' }
  | { kind: 'planner'; notice?: string; hasAuthParam: boolean; shareCode?: string };

/** A short link's path. Its code is not checked here: a mistyped one gets the server's 404, and with it the "no longer works" page. */
const SHARE_PATH = /^\/s\/([^/]+)\/?$/;

/** What this page load is for. Pure — StrictMode calls it twice — so the address bar is cleaned in an effect. */
function readEntry(): Entry {
  const { pathname, search, hash } = window.location;
  const token = new URLSearchParams(hash.slice(1)).get('token');
  if (token && pathname === '/reset') return { kind: 'reset', token };
  if (token && pathname === '/verify') return { kind: 'verify', token };
  // With a payload already stored the handshake is over, unless the old site opened this tab again
  // (?handoff=1 plus an opener): then the stale payload must not block a fresh move.
  if (pathname === '/migrate') {
    const handoff = new URLSearchParams(search).get('handoff') === '1' && !!window.opener;
    if (handoff || !loadPendingMigration()) return { kind: 'migrate' };
  }
  const auth = new URLSearchParams(search).get('auth');
  return {
    kind: 'planner',
    notice: auth === null ? undefined : AUTH_NOTICES.get(auth),
    hasAuthParam: auth !== null,
    shareCode: SHARE_PATH.exec(pathname)?.[1],
  };
}

export default function Root() {
  const [entry] = useState(readEntry);
  const [received, setReceived] = useState(false);
  const onReceived = useCallback(() => setReceived(true), []);

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const handoff = pathname === '/migrate' && new URLSearchParams(search).has('handoff');
    if (entry.kind !== 'planner') {
      // A token left in the address bar would stay in history and in any copy of the URL;
      // handoff is a one-time flag and must not ride along into a sign-in redirect.
      const params = new URLSearchParams(search);
      params.delete('handoff');
      const rest = params.toString();
      window.history.replaceState(null, '', pathname + (rest ? `?${rest}` : ''));
    } else if (entry.hasAuthParam || handoff) {
      // The notice is shown once; a reload or a bookmark must not repeat it.
      const params = new URLSearchParams(search);
      params.delete('auth');
      params.delete('handoff');
      const rest = params.toString();
      window.history.replaceState(null, '', pathname + (rest ? `?${rest}` : '') + hash);
    }
  }, [entry]);

  if (entry.kind === 'reset') return <ResetPasswordScreen token={entry.token} />;
  if (entry.kind === 'verify') return <VerifyScreen token={entry.token} />;
  if (entry.kind === 'migrate' && !received) return <MigrateReceiver onReceived={onReceived} />;
  const planner = entry.kind === 'planner' ? entry : undefined;
  return <SignInGate notice={planner?.notice} shareCode={planner?.shareCode} />;
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'offline' }
  /** `saveTo`: they asked to save a shared plan, and signing in comes back there. */
  | { kind: 'signed-out'; saveTo?: string }
  /** Someone's plan, read-only, signed out. `code` is null for a #p= link: that plan is in the hash, not on the server. */
  | { kind: 'shared'; name: string; plan: PlanState; code: string | null }
  | { kind: 'gone' }
  | { kind: 'import'; me: Me; snapshot: WebSnapshot; payload: MigrationPayload; adopt?: AdoptPlan }
  | { kind: 'planner'; boot: CloudBoot; nonce: number; flash?: string };
type PlannerScreen = Extract<Screen, { kind: 'planner' }>;
type SharedScreen = Extract<Screen, { kind: 'shared' }>;
type Shared = { name: string; plan: PlanState };

type Loaded = { kind: 'offline' } | { kind: 'signed-out' } | { kind: 'ready'; me: Me; snapshot: WebSnapshot };

/** A refocus refresh downloads the whole account; the TSS ↔ planner back-and-forth must not do that every few seconds. */
const REFRESH_MIN_GAP_MS = 30_000;

const SAVED_SHARED = 'Saved the shared plan to your account — you can edit it now';

/**
 * Drop the address bar's hash before another App mounts. A mounted planner
 * mirrors its active plan there as #m=; a fresh mount reads the hash on load,
 * and the old mirror would then pass for someone else's plan (overwriting the
 * received slot) or switch this tab back to the plan it showed before.
 */
function dropAddressHash(): void {
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

async function loadAccount(): Promise<Loaded> {
  let me: Me | null;
  try {
    me = await fetchMe();
  } catch {
    return { kind: 'offline' };
  }
  if (!me) return { kind: 'signed-out' };
  try {
    return { kind: 'ready', me, snapshot: await fetchState() };
  } catch (err) {
    return { kind: err instanceof UnauthorizedError ? 'signed-out' : 'offline' };
  }
}

function SignInGate({ notice, shareCode }: { notice?: string; shareCode?: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  // The address bar's short link, until it has been opened signed in.
  const share = useRef<string | null>(shareCode ?? null);
  // The ?auth= notice explains this page load only; a later sign-out must not repeat it.
  const [pageNotice, setPageNotice] = useState(notice);
  // Listeners and async continuations read the live screen, not the one they closed over.
  const current = useRef<Screen>(screen);
  const nonce = useRef(0);
  // One load or refresh in flight at a time; StrictMode's second effect run joins the first.
  const busy = useRef(false);
  const alive = useRef(true);
  // When the planner last got the server's state (boot or refresh), for REFRESH_MIN_GAP_MS.
  const lastFresh = useRef(0);

  const show = useCallback((next: Screen) => {
    current.current = next;
    setScreen(next);
  }, []);

  const mountPlanner = useCallback(
    (me: Me, snapshot: WebSnapshot, flash?: string, adopt?: AdoptPlan) => {
      // On the page's first entry the hash is the link the student opened. After a planner has
      // been mounted here (signed out mid-session, back in), it can only be that planner's mirror.
      if (nonce.current > 0) dropAddressHash();
      restorePendingHash();
      setPageNotice(undefined);
      lastFresh.current = Date.now();
      const boot = makeBoot(me, snapshot);
      if (adopt) {
        boot.adopt = adopt;
        saveViewing('mine'); // the plan they just saved, not one received earlier in this tab
      }
      show({ kind: 'planner', boot, nonce: nonce.current++, flash: flash ?? (adopt ? SAVED_SHARED : undefined) });
    },
    [show],
  );

  /** Signed in: plans waiting from the old site are confirmed before the planner (and its engine) exists. */
  const enter = useCallback(
    (me: Me, snapshot: WebSnapshot, adopt?: AdoptPlan) => {
      const payload = loadPendingMigration();
      if (payload) show({ kind: 'import', me, snapshot, payload, adopt });
      else mountPlanner(me, snapshot, undefined, adopt);
    },
    [mountPlanner, show],
  );

  const importDone = useCallback(
    async (s: Extract<Screen, { kind: 'import' }>, outcome: ImportOutcome) => {
      if (outcome.kind === 'signed-out') {
        show({ kind: 'signed-out' });
        return;
      }
      // Leave the confirm screen first: its buttons must not be clickable while the GET is out.
      show({ kind: 'loading' });
      // Whatever happened there (even a half-applied attempt), the planner boots from what the server holds now.
      const flash = outcome.kind !== 'imported' ? undefined
        : outcome.coursesOnly ? 'Moved your saved courses to your account.'
        : `Moved ${outcome.plans} ${pluralize(outcome.plans, 'plan')} to your account.`;
      try {
        const fresh = await fetchState();
        if (alive.current) mountPlanner(s.me, fresh, flash, s.adopt);
      } catch (err) {
        if (alive.current) show({ kind: err instanceof UnauthorizedError ? 'signed-out' : 'offline' });
      }
    },
    [mountPlanner, show],
  );

  /** A short link opened signed in is done with. */
  const settleLink = useCallback(() => {
    clearPendingShare(); // whichever link this was, a stash still around is this one: it is done
    share.current = null;
    // The planner lives at "/", and a reload must not fetch the link again.
    if (SHARE_PATH.test(window.location.pathname)) window.history.replaceState(null, '', '/');
  }, []);

  /** A shared plan opened signed in: into the received slot, on show, as a #p= link would be. */
  const receive = useCallback(
    (plan: PlanState) => {
      saveReceived({ plan, source: 'link', receivedAt: new Date().toISOString() });
      saveViewing('received');
      settleLink();
    },
    [settleLink],
  );

  /**
   * "Save to my account" on a shared plan: sign in, then it is saved without a second click.
   * returnTo serves Google and same-tab sign-ins; a short link's stash also serves the confirm mail.
   */
  const saveShared = useCallback(
    (s: SharedScreen) => {
      if (s.code) stashPendingShare(s.code);
      else stashPendingSave(window.location.hash); // the #p= link on show: that is where s.plan came from
      show({ kind: 'signed-out', saveTo: s.code ? `/s/${s.code}` : '/' });
    },
    [show],
  );

  /** Ask the server who this is. `recheck` = the tab came back while signed out: an unreachable server keeps the form. */
  const load = useCallback(
    async (why: 'start' | 'retry' | 'recheck') => {
      if (busy.current) return;
      busy.current = true;
      const unreachable = () => {
        if (why !== 'recheck' || current.current.kind === 'offline') show({ kind: 'offline' });
      };
      /** A short link's snapshot, or null once the screen says why there is none. A dead link's stash goes with it. */
      const openShare = async (code: string): Promise<Shared | null> => {
        const s = await fetchShare(code);
        if (!alive.current) return null;
        if (s === 'not-found') {
          clearPendingShare();
          show({ kind: 'gone' });
          return null;
        }
        if (s === null) unreachable(); // a stash stays for Try again or the next load
        return s;
      };
      try {
        // A short link in the address bar shows without a session, so it is fetched before asking who this is.
        // It is newer than any link stashed earlier, whatever this fetch brings, so those give way now. The one
        // exception is its own "Save to my account": that stash waits to be opened once signed in.
        let shared: Shared | null = null;
        const link = share.current;
        if (link) {
          dropPendingHash();
          if (peekPendingShare() !== link) clearPendingShare();
          shared = await openShare(link);
          if (!shared) return;
        }
        const r = await loadAccount();
        if (!alive.current) return;
        if (r.kind === 'ready') {
          // Saving was what they asked for before signing in, so a link whose own "Save to my account"
          // was clicked is saved now; one merely opened goes to the received slot.
          let save = shared !== null && peekPendingShare() === link;
          // A link saved before signing in, maybe in another tab, unless the hash is a (newer) link of its own;
          // after a planner has been mounted here, the hash is only that planner's mirror (see mountPlanner).
          const pending = shared ? null : peekPendingShare();
          if (pending && nonce.current === 0 && carriesPlan(window.location.hash)) {
            clearPendingShare();
          } else if (pending) {
            shared = await openShare(pending);
            if (!shared) return;
            save = true;
          }
          let adopt: AdoptPlan | undefined;
          if (shared && save) {
            adopt = { name: shared.name, plan: shared.plan };
            settleLink();
          } else if (shared) {
            receive(shared.plan);
          }
          // The same for a #p= link (this tab only). It goes from the address bar too, or it would also open as received.
          const hashSave = takePendingSave();
          if (hashSave && !adopt) {
            adopt = { name: 'Shared plan', plan: hashSave.plan };
            if (window.location.hash === hashSave.hash) dropAddressHash();
          }
          enter(r.me, r.snapshot, adopt);
        } else if (r.kind === 'signed-out') {
          stashPendingHash(window.location.hash);
          if (current.current.kind === 'signed-out') return;
          // Someone's plan comes before any sign-in wall. A #p= that does not decode is no plan: straight to the form.
          const hashPlan = shared ? null : planFromHash(window.location.hash);
          if (shared) show({ kind: 'shared', name: shared.name, plan: shared.plan, code: share.current });
          else if (hashPlan) show({ kind: 'shared', name: 'Shared plan', plan: hashPlan, code: null });
          else show({ kind: 'signed-out' });
        } else {
          unreachable();
        }
      } finally {
        busy.current = false;
      }
    },
    [enter, receive, settleLink, show],
  );

  /** The tab came back: if another device changed the account, remount on the server's state. */
  const refresh = useCallback(
    async (s: PlannerScreen) => {
      const { engine } = s.boot;
      // Unsaved edits would be lost by a remount; they save first and the next visit compares.
      if (busy.current || engine.hasPending() || Date.now() - lastFresh.current < REFRESH_MIN_GAP_MS) return;
      busy.current = true;
      // A save that starts and finishes while the GET is out can make the answer older than our acks.
      let saved = false;
      const off = engine.subscribe(() => {
        saved = true;
      });
      try {
        let fresh: WebSnapshot;
        try {
          fresh = await fetchState();
        } catch (err) {
          if (err instanceof UnauthorizedError && alive.current && current.current === s) {
            engine.dispose();
            dropAddressHash();
            show({ kind: 'signed-out' });
          }
          return; // unreachable, timed out or a server hiccup: keep the planner as it is
        }
        lastFresh.current = Date.now();
        if (!alive.current || current.current !== s || saved || engine.hasPending() || engine.matchesServer(fresh)) return;
        engine.dispose();
        dropAddressHash();
        show({ kind: 'planner', boot: makeBoot(s.boot.me, fresh), nonce: nonce.current++ });
      } finally {
        off();
        busy.current = false;
      }
    },
    [show],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void load('start');
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const s = current.current;
      if (s.kind === 'planner') void refresh(s);
      // Signed out here, but maybe signed in since in another tab (the emailed confirm link).
      else if (s.kind === 'signed-out' || s.kind === 'offline') void load('recheck');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, refresh]);

  switch (screen.kind) {
    case 'loading':
      return <main className="auth" aria-busy="true" />;
    case 'offline':
      return (
        <AuthCard heading="Can't reach TritonPlan right now.">
          <button
            type="button"
            className="btn btn--primary auth__wide"
            onClick={() => {
              if (busy.current) return;
              show({ kind: 'loading' });
              void load('retry');
            }}
          >
            Try again
          </button>
        </AuthCard>
      );
    case 'gone':
      return <ShareGone />;
    case 'shared':
      // The snapshot is only loosely checked by the server: a malformed one must not leave a blank page.
      return (
        <ErrorBoundary>
          <SharedPlanView name={screen.name} plan={screen.plan} onSave={() => saveShared(screen)} />
        </ErrorBoundary>
      );
    case 'signed-out':
      if (screen.saveTo) {
        return <LoginScreen notice={pageNotice} heading="Sign in to save this plan" returnTo={screen.saveTo} />;
      }
      // Back to "/", not "/migrate": enter() picks a pending payload up on any path, while /migrate without one
      // (imported meanwhile in another tab) would wait for the old site forever.
      return loadPendingMigration() ? (
        <LoginScreen notice={pageNotice} heading="Sign in to finish moving your plans" returnTo="/" />
      ) : (
        <LoginScreen notice={pageNotice} returnTo={window.location.pathname} />
      );
    case 'import':
      return <ImportConfirm snapshot={screen.snapshot} payload={screen.payload} onDone={(o) => void importDone(screen, o)} />;
    case 'planner':
      // The tab keeps viewing a received plan across reloads; if that plan is what crashed, Reload would crash again.
      return (
        <ErrorBoundary key={screen.nonce} onReload={() => saveViewing('mine')}>
          <App boot={screen.boot} initialFlash={screen.flash} />
        </ErrorBoundary>
      );
  }
}

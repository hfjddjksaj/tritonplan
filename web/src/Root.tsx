/**
 * The sign-in gate. Nothing of the planner mounts until the account and its
 * state have loaded, so a signed-out visitor never sees it and an extension
 * push waits in the bridge hub until usePlan subscribes. Emailed links
 * (/reset, /verify) are handled first: they work signed out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import App from './App';
import { AuthCard } from './components/auth/AuthCard';
import { AUTH_NOTICES } from './components/auth/copy';
import { LoginScreen } from './components/auth/LoginScreen';
import { ImportConfirm, type ImportOutcome } from './components/migrate/ImportConfirm';
import { MigrateReceiver } from './components/migrate/MigrateReceiver';
import { ResetPasswordScreen } from './components/auth/ResetPasswordScreen';
import { VerifyScreen } from './components/auth/VerifyScreen';
import { fetchMe, fetchState, UnauthorizedError, type Me } from './lib/cloud/api';
import { makeBoot, restorePendingHash, stashPendingHash, type CloudBoot } from './lib/cloud/boot';
import { pluralize } from './lib/format';
import type { WebSnapshot } from './lib/cloud/records';
import { loadPendingMigration, type MigrationPayload } from './lib/migration';

type Entry =
  | { kind: 'reset'; token: string }
  | { kind: 'verify'; token: string }
  | { kind: 'migrate' }
  | { kind: 'planner'; notice?: string; hasAuthParam: boolean };

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
  return { kind: 'planner', notice: auth === null ? undefined : AUTH_NOTICES.get(auth), hasAuthParam: auth !== null };
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
  return <SignInGate notice={entry.kind === 'planner' ? entry.notice : undefined} />;
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'import'; me: Me; snapshot: WebSnapshot; payload: MigrationPayload }
  | { kind: 'planner'; boot: CloudBoot; nonce: number; flash?: string };
type PlannerScreen = Extract<Screen, { kind: 'planner' }>;

type Loaded = { kind: 'offline' } | { kind: 'signed-out' } | { kind: 'ready'; me: Me; snapshot: WebSnapshot };

/** A refocus refresh downloads the whole account; the TSS ↔ planner back-and-forth must not do that every few seconds. */
const REFRESH_MIN_GAP_MS = 30_000;

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

function SignInGate({ notice }: { notice?: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
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
    (me: Me, snapshot: WebSnapshot, flash?: string) => {
      // On the page's first entry the hash is the link the student opened. After a planner has
      // been mounted here (signed out mid-session, back in), it can only be that planner's mirror.
      if (nonce.current > 0) dropAddressHash();
      restorePendingHash();
      setPageNotice(undefined);
      lastFresh.current = Date.now();
      show({ kind: 'planner', boot: makeBoot(me, snapshot), nonce: nonce.current++, flash });
    },
    [show],
  );

  /** Signed in: plans waiting from the old site are confirmed before the planner (and its engine) exists. */
  const enter = useCallback(
    (me: Me, snapshot: WebSnapshot) => {
      const payload = loadPendingMigration();
      if (payload) show({ kind: 'import', me, snapshot, payload });
      else mountPlanner(me, snapshot);
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
        if (alive.current) mountPlanner(s.me, fresh, flash);
      } catch (err) {
        if (alive.current) show({ kind: err instanceof UnauthorizedError ? 'signed-out' : 'offline' });
      }
    },
    [mountPlanner, show],
  );

  /** Ask the server who this is. `recheck` = the tab came back while signed out: an unreachable server keeps the form. */
  const load = useCallback(
    async (why: 'start' | 'retry' | 'recheck') => {
      if (busy.current) return;
      busy.current = true;
      try {
        const r = await loadAccount();
        if (!alive.current) return;
        if (r.kind === 'ready') {
          enter(r.me, r.snapshot);
        } else if (r.kind === 'signed-out') {
          stashPendingHash(window.location.hash);
          if (current.current.kind !== 'signed-out') show({ kind: 'signed-out' });
        } else if (why !== 'recheck' || current.current.kind === 'offline') {
          show({ kind: 'offline' });
        }
      } finally {
        busy.current = false;
      }
    },
    [enter, show],
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
    case 'signed-out':
      return loadPendingMigration() ? (
        <LoginScreen notice={pageNotice} heading="Sign in to finish moving your plans" returnTo="/migrate" />
      ) : (
        <LoginScreen notice={pageNotice} returnTo={window.location.pathname} />
      );
    case 'import':
      return <ImportConfirm snapshot={screen.snapshot} payload={screen.payload} onDone={(o) => void importDone(screen, o)} />;
    case 'planner':
      return <App boot={screen.boot} key={screen.nonce} initialFlash={screen.flash} />;
  }
}

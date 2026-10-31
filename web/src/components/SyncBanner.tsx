import type { SyncEngine, SyncStatus } from '../lib/cloud/engine';
import { useSyncStatus } from '../lib/cloud/engine';
import { nav } from '../lib/nav';

type Shown = Exclude<SyncStatus, 'idle' | 'saving'>;

// Every recovery is a reload: the page then re-reads the account from the server
// (or lands on the sign-in screen), which is the only state the engine can trust.
const MESSAGES: Record<Shown, { text: string; action?: string }> = {
  offline: { text: "Can't reach TritonPlan. Your latest changes will save when you're back online." },
  conflict: {
    text: "This plan changed on another device. Reload to get the latest — changes made here since then weren't saved.",
    action: 'Reload',
  },
  'signed-out': { text: "You've been signed out. Sign in again to keep saving.", action: 'Sign in' },
  error: { text: "Couldn't save your latest change.", action: 'Reload' },
};

/** Says when edits are not reaching the account. Silent while saving normally. */
export function SyncBanner({ engine }: { engine: SyncEngine }) {
  const status = useSyncStatus(engine);
  if (status === 'idle' || status === 'saving') return null;
  const m = MESSAGES[status];
  return (
    // offline heals itself, so it is a polite status; the rest need the student to act.
    <div className="syncbar" role={status === 'offline' ? 'status' : 'alert'}>
      <span className="syncbar__text">{m.text}</span>
      {m.action && (
        <button type="button" className="btn btn--sm" onClick={() => nav.reload()}>
          {m.action}
        </button>
      )}
    </div>
  );
}

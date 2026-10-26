/**
 * Asks before the old site's plans go into the account, then sends them. The
 * pending payload stays in storage until the import succeeds or the student
 * discards it, so a failure, a closed tab or a sign-in redirect loses nothing.
 */
import { useRef, useState } from 'react';
import { fetchState, postSync, UnauthorizedError } from '../../lib/cloud/api';
import { ackedFromSnapshot, diffOps } from '../../lib/cloud/diff';
import { batchOps } from '../../lib/cloud/engine';
import { termsFromSnapshot, type WebSnapshot } from '../../lib/cloud/records';
import { pluralize } from '../../lib/format';
import { clearPendingMigration, mergeMigration, type MigrationPayload } from '../../lib/migration';
import { AuthCard, AuthMessage } from '../auth/AuthCard';

export type ImportOutcome =
  | { kind: 'imported'; plans: number }
  | { kind: 'cleared' }
  | { kind: 'later' }
  | { kind: 'signed-out' };

type View = 'ask' | 'discard' | 'nothing';

const FAILED = "Couldn't add your plans. Please try again.";

/** What importing `payload` into the account held by `snapshot` would do. */
function plan(snapshot: WebSnapshot, payload: MigrationPayload) {
  const merged = mergeMigration(
    { terms: termsFromSnapshot(snapshot), pool: snapshot.pool, appt: snapshot.appt },
    payload,
    new Date().toISOString(),
  );
  // "Nothing new" is judged on the ops, not the plan count: a pool or appointment-only change is still worth sending.
  const ops = diffOps(ackedFromSnapshot(snapshot), { terms: merged.terms, pool: merged.pool, appt: merged.appt });
  return { merged, ops };
}

export function ImportConfirm({
  snapshot,
  payload,
  onDone,
}: {
  snapshot: WebSnapshot;
  payload: MigrationPayload;
  onDone: (outcome: ImportOutcome) => void;
}) {
  const [preview] = useState(() => plan(snapshot, payload));
  const [view, setView] = useState<View>(preview.ops.length === 0 ? 'nothing' : 'ask');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);

  const finish = (outcome: ImportOutcome) => {
    // The address bar goes home whichever way this ends: /migrate has done its job.
    window.history.replaceState(null, '', '/');
    onDone(outcome);
  };
  const clearAndFinish = () => {
    clearPendingMigration();
    finish({ kind: 'cleared' });
  };

  async function add() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(false);
    try {
      // Every attempt starts from the server's present state: a half-applied earlier attempt or
      // another device's edit then shows up as already-done work, because the merge is idempotent.
      let fresh: WebSnapshot;
      try {
        fresh = await fetchState();
      } catch (err) {
        if (err instanceof UnauthorizedError) return finish({ kind: 'signed-out' });
        setFailed(true);
        return;
      }
      const { merged, ops } = plan(fresh, payload);
      if (ops.length === 0) {
        setView('nothing');
        return;
      }
      for (const batch of batchOps(ops)) {
        const r = await postSync(batch);
        if (!r.ok) {
          if (r.kind === 'unauthorized') return finish({ kind: 'signed-out' });
          setFailed(true);
          return;
        }
      }
      clearPendingMigration();
      finish({ kind: 'imported', plans: merged.added.plans });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (view === 'nothing') {
    return (
      <AuthCard heading="Move your plans">
        <p className="auth__lede">These plans are already in your account.</p>
        <button type="button" className="btn btn--primary auth__wide" onClick={clearAndFinish}>OK</button>
      </AuthCard>
    );
  }

  if (view === 'discard') {
    return (
      <AuthCard heading="Move your plans">
        <p className="auth__lede">
          Discard the plans from the old site? They stay on the old site, so you can move them again later.
        </p>
        <button type="button" className="btn btn--primary auth__wide" onClick={clearAndFinish}>Discard</button>
        <p className="auth__switch">
          <button type="button" className="auth__link" onClick={() => setView('ask')}>Keep</button>
        </p>
      </AuthCard>
    );
  }

  const { plans, terms } = preview.merged.added;
  return (
    <AuthCard heading="Move your plans">
      <p className="auth__lede">
        We found {plans} {pluralize(plans, 'plan')} in {terms} {pluralize(terms, 'term')} from the old TritonPlan.
      </p>
      {failed && <AuthMessage tone="error">{FAILED}</AuthMessage>}
      <button type="button" className="btn btn--primary auth__wide" disabled={busy} onClick={() => void add()}>
        {failed ? 'Try again' : 'Add to my account'}
      </button>
      <p className="auth__switch">
        <button type="button" className="auth__link" disabled={busy} onClick={() => finish({ kind: 'later' })}>Not now</button>
        <button type="button" className="auth__link" disabled={busy} onClick={() => setView('discard')}>Discard…</button>
      </p>
    </AuthCard>
  );
}

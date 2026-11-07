/**
 * A plan opened from its share link (/s/<code>), for anyone holding the link, signed in or not.
 * The planner's own body, drawn from the shared copy: its courses, week, exams and map, with a
 * section switch as the only edit. The visitor's account is touched only by "Save to my plans",
 * which writes the courses they pick into it from here, without leaving the page. The extension's
 * "+ TritonPlan" clicks are not this page's to take.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSharedPlan, type SharedPlan, type SharedPlanStatus } from '../../hooks/useSharedPlan';
import { sharedController } from '../../hooks/sharedController';
import { deferPlanAdds } from '../../lib/bridge';
import { clearPendingShare, peekPendingShare, stashPendingShare } from '../../lib/cloud/boot';
import { loadMyPlans, saveSharedToAccount, type SharedSave } from '../../lib/shared-save';
import { isArchived } from '../../lib/terms';
import { AuthCard } from '../auth/AuthCard';
import { LoginScreen } from '../auth/LoginScreen';
import { Check } from '../icons';
import { PlannerBody, type CampusOpen } from '../PlannerBody';
import { TooltipLayer } from '../Tooltip';
import { SaveSharedDialog } from './SaveSharedDialog';
import { ShareGone } from './ShareGone';
import { SharedTopbar } from './SharedTopbar';

/** `?save=1`: back from signing in to save this plan; the dialog opens once the plan is in. */
const SAVE_PARAM = 'save';
const askedToSave = (): boolean => new URLSearchParams(window.location.search).get(SAVE_PARAM) === '1';

export function SharedPlanPage({ code }: { code: string }) {
  const { status, select, retry } = useSharedPlan(code);
  const [saveOnOpen, setSaveOnOpen] = useState(askedToSave);

  // An extension from before shared pages existed still drains its clicks into any planner tab.
  useEffect(() => {
    deferPlanAdds();
  }, []);

  // The flag is for this load only: a reload, or the link copied from the address bar, must not open the dialog.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(SAVE_PARAM)) return;
    params.delete(SAVE_PARAM);
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  }, []);

  // The link stashed for the sign-in round trip has brought them back, to its dialog or to the news it expired:
  // the next planner load must not send them here again.
  const settled = status.kind === 'ready' || status.kind === 'gone';
  useEffect(() => {
    if (saveOnOpen && settled && peekPendingShare() === code) clearPendingShare();
  }, [saveOnOpen, settled, code]);
  const saveOpened = useCallback(() => setSaveOnOpen(false), []);

  switch (status.kind) {
    case 'loading':
      return <main className="auth" aria-busy="true" />;
    case 'offline':
      return (
        <AuthCard heading="Can't reach TritonPlan right now.">
          <button type="button" className="btn btn--primary auth__wide" onClick={retry}>
            Try again
          </button>
        </AuthCard>
      );
    case 'gone':
      return <ShareGone />;
    case 'ready':
      return <SharedPlanReady code={code} doc={status} select={select} openSave={saveOnOpen} onSaveOpened={saveOpened} />;
  }
}

type SaveStep =
  | { kind: 'idle' }
  /** Asking the server who this is and which plans they have. */
  | { kind: 'checking' }
  | { kind: 'sign-in' }
  | { kind: 'dialog'; myPlans: { id: string; name: string }[] | null; saving: boolean; error: string | null };

function SharedPlanReady({
  code,
  doc,
  select,
  openSave,
  onSaveOpened,
}: {
  code: string;
  doc: Extract<SharedPlanStatus, { kind: 'ready' }>;
  select: SharedPlan['select'];
  /** Open "Save to my plans" as soon as this mounts. */
  openSave: boolean;
  onSaveOpened: () => void;
}) {
  const ctl = useMemo(() => sharedController(doc.plan, select), [doc.plan, select]);
  const isMobile = useIsMobile();
  const [campus, setCampus] = useState<CampusOpen>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [step, setStep] = useState<SaveStep>({ kind: 'idle' });
  // Async continuations read the live step, not the one they closed over.
  const stepRef = useRef(step);
  const go = useCallback((next: SaveStep) => {
    stepRef.current = next;
    setStep(next);
  }, []);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/s/${code}`;
    // Written straight from the click: WebKit refuses a clipboard write that comes after an await.
    let written: Promise<void>;
    try {
      written = navigator.clipboard.writeText(url);
    } catch (err) {
      written = Promise.reject(err); // no clipboard API at all (an insecure origin)
    }
    written.then(
      () => setToast('Link copied'),
      () => setToast(`Couldn't copy automatically — the link is ${url}`),
    );
  }, [code]);

  // Sign-in leaves the page; returnTo brings Google and a password sign-in back to this dialog, and the stash
  // brings the emailed confirm link's tab (which lands on "/") here too.
  const signIn = useCallback(() => {
    stashPendingShare(code);
    go({ kind: 'sign-in' });
  }, [code, go]);

  const term = doc.plan.term;
  const startSave = useCallback(async () => {
    if (stepRef.current.kind !== 'idle') return;
    go({ kind: 'checking' });
    const myPlans = await loadMyPlans(term);
    if (!alive.current) return;
    if (myPlans === 'signed-out') signIn();
    else go({ kind: 'dialog', myPlans, saving: false, error: null });
  }, [term, go, signIn]);

  const confirmSave = useCallback(
    async (save: SharedSave) => {
      const open = stepRef.current;
      if (open.kind !== 'dialog' || open.saving) return;
      go({ ...open, saving: true, error: null });
      const r = await saveSharedToAccount(save);
      if (!alive.current) return;
      if (r.ok) {
        go({ kind: 'idle' });
        const { kind, planName } = r.outcome;
        setToast(kind === 'new' ? `Saved to your plans as "${planName}"` : `Replaced "${planName}" with the courses you picked`);
      } else if (r.reason === 'signed-out') signIn();
      else go({ ...open, saving: false, error: "Couldn't save. Try again." });
    },
    [go, signIn],
  );

  useEffect(() => {
    if (!openSave) return;
    onSaveOpened();
    void startSave();
  }, [openSave, onSaveOpened, startSave]);

  const { name, plan, version, expiresAt } = doc;
  return (
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      <SharedTopbar
        term={plan.term}
        units={ctl.units}
        expiresAt={expiresAt}
        onOpenMap={() => setCampus({})}
        onCopyLink={copyLink}
        onSave={() => void startSave()}
      />
      <PlannerBody ctl={ctl} campus={campus} setCampus={setCampus} />

      {step.kind === 'dialog' && (
        <SaveSharedDialog
          doc={{ name, plan, version, expiresAt }}
          myPlans={step.myPlans}
          termArchived={isArchived(plan.term, new Date())}
          saving={step.saving}
          error={step.error}
          onConfirm={(save) => void confirmSave(save)}
          onClose={() => go({ kind: 'idle' })}
        />
      )}
      {step.kind === 'sign-in' && (
        <LoginScreen returnTo={`/s/${code}?${SAVE_PARAM}=1`} dialog={{ onClose: () => go({ kind: 'idle' }), delayed: false }} />
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={16} className="toast__check" /> {toast}
        </div>
      )}

      {/* Every tip() on the page renders here; last, so it sits above everything that mounted. */}
      <TooltipLayer />
    </div>
  );
}

/**
 * A plan opened from its share link (/s/<code>), for anyone holding the link, signed in or not.
 * The planner's own body, drawn from the shared copy: its courses, week, exams and map, with a
 * section switch as the only edit. Nothing here reads or writes the visitor's account, and the
 * extension's "+ TritonPlan" clicks are not this page's to take.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSharedPlan, type SharedPlan, type SharedPlanStatus } from '../../hooks/useSharedPlan';
import { sharedController } from '../../hooks/sharedController';
import { deferPlanAdds } from '../../lib/bridge';
import type { SharedDoc } from '../../lib/cloud/api';
import { AuthCard } from '../auth/AuthCard';
import { Check } from '../icons';
import { PlannerBody, type CampusOpen } from '../PlannerBody';
import { TooltipLayer } from '../Tooltip';
import { ShareGone } from './ShareGone';
import { SharedTopbar } from './SharedTopbar';

interface Props {
  code: string;
  /** "Save to my plans", with the plan as it is on screen. */
  onSave: (doc: SharedDoc) => void;
}

export function SharedPlanPage({ code, onSave }: Props) {
  const { status, select, retry } = useSharedPlan(code);

  // An extension from before shared pages existed still drains its clicks into any planner tab.
  useEffect(() => {
    deferPlanAdds();
  }, []);

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
      return <SharedPlanReady code={code} doc={status} select={select} onSave={onSave} />;
  }
}

function SharedPlanReady({
  code,
  doc,
  select,
  onSave,
}: {
  code: string;
  doc: Extract<SharedPlanStatus, { kind: 'ready' }>;
  select: SharedPlan['select'];
  onSave: (doc: SharedDoc) => void;
}) {
  const ctl = useMemo(() => sharedController(doc.plan, select), [doc.plan, select]);
  const isMobile = useIsMobile();
  const [campus, setCampus] = useState<CampusOpen>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const { name, plan, version, expiresAt } = doc;
  return (
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      <SharedTopbar
        term={plan.term}
        units={ctl.units}
        expiresAt={expiresAt}
        onOpenMap={() => setCampus({})}
        onCopyLink={copyLink}
        onSave={() => onSave({ name, plan, version, expiresAt })}
      />
      <PlannerBody ctl={ctl} campus={campus} setCampus={setCampus} />

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

/**
 * What a signed-out visitor sees at the planner's address: the planner's week with
 * whatever the extension just brought from TSS, and the sign-in card over it a
 * moment later. A student sent here by "+ TritonPlan" sees their course first, so
 * they know they are in the right place, not a bare sign-in page. Nothing here is
 * saved; the clicks stay queued and land in the plan once they sign in.
 */
import { useEffect, useMemo, useState } from 'react';
import { peekBridge, watchBridge } from '../../lib/bridge';
import { emptyPlan } from '../../lib/plan';
import { previewOf } from '../../lib/preview';
import { displayTermLabel } from '../../lib/terms';
import { Calendar } from '../icons';
import { PlanPicture, SharedBar } from '../share/SharedPlanView';
import { LoginScreen } from './LoginScreen';

const BROUGHT_LEDE = 'Your courses from TSS are here. Sign in and they go into your plan, on any device.';
const OPEN_LEDE = 'Plan your quarter around real sections and times. Your plans are saved to your account, so they follow you to any device.';

export function SignedOutPreview({ notice, returnTo }: { notice?: string; returnTo: string }) {
  const [seen, setSeen] = useState(peekBridge);
  useEffect(() => {
    setSeen(peekBridge()); // whatever arrived between the first render and now
    return watchBridge(() => setSeen(peekBridge()));
  }, []);
  const preview = useMemo(() => previewOf(seen, new Date()), [seen]);
  // A notice (a failed Google sign-in, an expired link) is news about signing in: no waiting for it.
  const [dialog, setDialog] = useState<'first' | 'open' | 'closed'>(notice ? 'open' : 'first');
  const open = () => setDialog('open');

  const planned = preview !== null && preview.plan.entries.length > 0;
  const title = preview === null ? 'Plan your quarter' : planned ? 'Your plan' : 'Your courses from TSS';
  const sub = preview === null ? 'Sign in to start planning.' : `${displayTermLabel(preview.term)} · not saved yet`;

  return (
    <main className="shared preview">
      <SharedBar />
      <div className="shared__body">
        <div className="shared__head">
          <div className="shared__titles">
            <h1 className="shared__title">{title}</h1>
            <p className="shared__sub">{sub}</p>
          </div>
          <button type="button" className="btn btn--primary shared__save" onClick={open}>
            {preview === null ? 'Sign in' : 'Sign in to save'}
          </button>
        </div>
        <PlanPicture
          plan={preview?.plan ?? emptyPlan()}
          empty={
            <div className="cal-wrap">
              <div className="empty">
                <Calendar size={40} className="empty__mark" strokeWidth={1.4} />
                <div className="empty__title">Your week is open</div>
                <p className="empty__text">
                  Click + TritonPlan on a course in TSS and its meetings drop onto the grid here, color-coded and
                  checked for time conflicts.
                </p>
              </div>
            </div>
          }
          side={
            preview !== null && preview.browsed.length > 0 ? (
              <section className="preview__browsed" aria-label="Browsed in TSS">
                <h2 className="preview__label">{planned ? 'Also browsed in TSS' : 'Browsed in TSS'}</h2>
                <ul className="shared__courses">
                  {preview.browsed.map((c) => (
                    <li key={c.id} className="shared__course">
                      <div className="shared__courseline">
                        <span className="shared__code">{c.courseCode}</span>
                      </div>
                      <div className="shared__name">{c.title}</div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : undefined
          }
        />
      </div>
      {dialog !== 'closed' && (
        <LoginScreen
          notice={notice}
          heading={preview === null ? undefined : 'Sign in to save your plan'}
          lede={preview === null ? OPEN_LEDE : BROUGHT_LEDE}
          returnTo={returnTo}
          dialog={{ onClose: () => setDialog('closed'), delayed: dialog === 'first' }}
        />
      )}
    </main>
  );
}

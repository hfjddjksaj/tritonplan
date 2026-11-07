import { useCallback, useEffect, useState } from 'react';
import { lockedForGuest, usePlan } from './hooks/usePlan';
import { useIsMobile } from './hooks/useIsMobile';
import { useApptTimes } from './hooks/useApptTimes';
import { Topbar } from './components/Topbar';
import { PlanSwitcher } from './components/PlanSwitcher';
import { ApptCapsule } from './components/ApptCapsule';
import { SyncBanner } from './components/SyncBanner';
import { ExtensionUpdateNote } from './components/ExtensionUpdateNote';
import { AccountMenu } from './components/AccountMenu';
import { ShareMenu } from './components/ShareMenu';
import { ReceivedBanner } from './components/ReceivedBanner';
import { GuestBanner } from './components/GuestBanner';
import { PlannerBody, type CampusOpen } from './components/PlannerBody';
import { TermSwitcher } from './components/TermSwitcher';
import { Check } from './components/icons';
import { TooltipLayer } from './components/Tooltip';
import { displayTermLabel, termKey } from './lib/terms';
import { TermOpenBanner } from './components/TermOpenBanner';
import { pluralize } from './lib/format';
import type { CloudBoot } from './lib/cloud/boot';
import { installUnloadGuard } from './lib/cloud/engine';

const noop = () => {};

export default function App({
  boot,
  initialFlash,
  onSignIn = noop,
}: {
  boot: CloudBoot;
  initialFlash?: string;
  /** Signed out (no `boot.me`): what the banner's Sign in button and every edit do. */
  onSignIn?: () => void;
}) {
  const own = usePlan(boot);
  const ctl = own.guest ? lockedForGuest(own, onSignIn) : own;
  const upcoming = ctl.upcomingTerm;
  const isMobile = useIsMobile();
  const appt = useApptTimes(boot);
  const [toast, setToast] = useState<string | null>(initialFlash ?? null);
  const [campus, setCampus] = useState<CampusOpen>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  // Once per boot: Root remounts App with a new boot on refocus, and the old
  // engine's listeners must not outlive it.
  useEffect(() => installUnloadGuard(boot.engine), [boot.engine]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSaveAsMine = useCallback(() => {
    const n = ctl.plan.entries.length;
    if (
      n > 0 &&
      !window.confirm(
        `Replace “${ctl.activePlanName}” (${n} ${pluralize(n, 'course')}) with this plan?`,
      )
    ) {
      return;
    }
    ctl.saveReceivedAsMine();
    flash(`Replaced “${ctl.activePlanName}” — you can edit it now`);
  }, [ctl, flash]);

  const handleSaveAsNewPlan = useCallback(() => {
    if (!ctl.received) return;
    const d = new Date(ctl.received.receivedAt);
    const fallback = `${ctl.received.source === 'link' ? 'Shared' : 'Imported'} plan ${d.getMonth() + 1}/${d.getDate()}`;
    const name = window.prompt('Name this plan', fallback);
    if (name === null) return;
    ctl.saveReceivedAsNewPlan(name.trim() || fallback);
    flash('Saved as a new plan — you can edit it now');
  }, [ctl, flash]);

  const handleDiscardReceived = useCallback(() => {
    if (window.confirm('Discard this plan? Your own plan is not affected.')) {
      ctl.discardReceived();
    }
  }, [ctl]);

  const handleReset = useCallback(() => {
    if (ctl.plan.entries.length === 0) return;
    if (window.confirm('Remove every course from the plan? Browsed courses stay.')) {
      ctl.resetPlan();
      flash('Plan cleared');
    }
  }, [ctl, flash]);

  return (
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      <Topbar
        termSlot={
          ctl.viewing === 'received' && ctl.received ? (
            <div className="topbar__term">
              <span className="eyebrow">Term</span>
              <span className="topbar__term-label">{displayTermLabel(ctl.viewPlan.term)}</span>
            </div>
          ) : (
            <TermSwitcher
              terms={ctl.termList}
              activeKey={ctl.activeTermKey}
              activeLabel={displayTermLabel(ctl.viewPlan.term)}
              archived={ctl.archived}
              onSwitch={ctl.switchTerm}
              onCreate={ctl.createTerm}
            />
          )
        }
        units={ctl.units}
        readOnly={ctl.readOnly || ctl.guest}
        planSwitcher={
          !ctl.guest && (
          <PlanSwitcher
            plans={ctl.plans.map((p) => ({ id: p.id, name: p.name, count: p.plan.entries.length }))}
            activeId={ctl.activePlanId}
            onSwitch={ctl.switchPlan}
            onCreate={ctl.createNewPlan}
            onRename={ctl.renamePlan}
            onDuplicate={ctl.duplicatePlan}
            onDelete={ctl.deletePlan}
          />
          )
        }
        apptSlot={<ApptCapsule appt={appt} term={ctl.viewPlan.term} />}
        accountSlot={
          // Signed out, the banner under the top bar carries the Sign in button.
          boot.me && <AccountMenu me={boot.me} terms={ctl.termsState} sharePlans={ctl.plans} onFlash={flash} flush={boot.engine.flush} />
        }
        shareSlot={
          // Into the calendar go the account's own plans: not signed out, not while someone else's plan is up.
          !ctl.guest && ctl.viewing === 'mine' && (
            <ShareMenu
              term={ctl.viewPlan.term}
              plans={ctl.plans.map((p) => ({ id: p.id, name: p.name, count: p.plan.entries.length }))}
              activeId={ctl.activePlanId}
              archived={ctl.archived}
              flush={boot.engine.flush}
              onFlash={flash}
            />
          )
        }
        onReset={handleReset}
        onOpenMap={() => setCampus({})}
      />
      <SyncBanner engine={boot.engine} />
      {/* For students upgrading from the old extension, who all have an account to sign in to. */}
      {!ctl.guest && <ExtensionUpdateNote />}
      {upcoming && !ctl.guest && ctl.viewing === 'mine' && !ctl.termsState.terms[termKey(upcoming)] && (
        <TermOpenBanner
          term={upcoming}
          activeLabel={displayTermLabel(ctl.viewPlan.term)}
          onCreate={() => ctl.createTerm(upcoming)}
        />
      )}
      {ctl.guest && <GuestBanner onSignIn={onSignIn} />}
      {ctl.received && (
        <ReceivedBanner
          received={ctl.received}
          viewing={ctl.viewing}
          onView={() => ctl.switchViewing('received')}
          onBackToMine={() => ctl.switchViewing('mine')}
          onSaveAsNew={handleSaveAsNewPlan}
          onSaveAsMine={handleSaveAsMine}
          onDiscard={handleDiscardReceived}
        />
      )}
      <PlannerBody ctl={ctl} campus={campus} setCampus={setCampus} />

      {toast && (
        <div className="toast" role="status">
          <Check size={16} className="toast__check" /> {toast}
        </div>
      )}

      {/* One bubble for the whole app — every `tip(...)` in the tree renders here.
          Last, so it portals out from above everything else that mounted. */}
      <TooltipLayer />
    </div>
  );
}

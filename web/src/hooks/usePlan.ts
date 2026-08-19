/** The app's single source of truth: the browsed course pool + the working plan, with actions. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BookedModule,
  type CourseOffering,
  type PlanState,
  type SectionOption,
  courseIdsInConflicts,
  findWeeklyConflicts,
  findFinalConflicts,
} from '@triton/shared';
import sampleCourses from '../data/sample-courses.json';
import { pickHue } from '../lib/colors';
import { installBridgeListener, mergeCourses, postForgetCourses } from '../lib/bridge';
import {
  applyAutoBooked,
  bookedSet,
  forgetAutoBooked,
  isAutoBookedSynced,
  toggleBooked as toggleBookedIn,
} from '../lib/booked';
import {
  loadPlan,
  loadPlans,
  loadTerms,
  saveTerms,
  loadPool,
  savePool,
  purgeSeededSamples,
  loadReceived,
  saveReceived,
  clearReceived,
  loadViewing,
  saveViewing,
  loadSyncedToken,
  type ReceivedPlan,
  type Viewing,
} from '../lib/storage';
import {
  activePlan,
  updateActivePlan,
  mapAllPlans,
  createPlan,
  addPlan,
  renamePlan as renamePlanIn,
  duplicatePlan as duplicatePlanIn,
  deletePlan as deletePlanIn,
  switchActive,
  addBrowsed,
  removeBrowsed,
  type PlansState,
} from '../lib/plans';
import {
  activeWorkspace,
  adoptSeedPlan,
  allPlansEmpty,
  archiveSweep,
  ensureWorkspace,
  mapWorkspaces,
  migrateToTermsState,
  newestTermKey,
  routeCapture,
  switchTermIn,
  updateWorkspace,
  type TermsState,
} from '../lib/terms-state';
import { isArchived, termKey, type TermKey } from '../lib/terms';
import { mirrorSeedPlan, planToMirrorHash, readHash } from '../lib/share';
import { openBooking, openInTss, openTssHome } from '../lib/tss';
import {
  buildSelectedCourses,
  emptyPlan,
  finalsSorted,
  meetingInstances,
  midtermsSorted,
  planUnits,
  refreshPlanEntries,
} from '../lib/plan';

// Demo seed for LOCAL DEV ONLY: stands in for courses the student has "browsed" in
// TSS so the UI isn't empty without the extension. Production ships an empty pool —
// the extension re-pushes the real pool on each load via a `courses` bridge message.
const SAMPLE = import.meta.env.DEV ? (sampleCourses as unknown as CourseOffering[]) : [];

/** One-shot boot: pool repository + terms container + the archive sweep's forget list. */
function initialState(): { pool: CourseOffering[]; terms: TermsState; forgetModuleIds: string[] } {
  const now = new Date();
  const iso = now.toISOString();
  const pool = mergeCourses(SAMPLE, purgeSeededSamples(loadPool() ?? []));
  let terms = migrateToTermsState(loadTerms(), loadPlans(), loadPlan(), pool, iso);
  if (allPlansEmpty(terms)) {
    // Nothing saved on this device yet, but the address bar carries our own mirror:
    // this is a synced/bookmarked tab opened somewhere new, so adopt it as the plan.
    const seed = mirrorSeedPlan(window.location.hash);
    if (seed) terms = adoptSeedPlan(terms, seed, iso);
  }
  const swept = archiveSweep(terms, pool, now);
  // Default view is always the NEWEST term (spec §6): the stored activeTermKey is
  // ignored on load.
  const state = switchTermIn(swept.state, newestTermKey(swept.state));
  return { pool: swept.pool, terms: state, forgetModuleIds: swept.forgetModuleIds };
}

/** Append a fresh plan entry, coloring it with the next hue in the palette. */
function appendEntry(
  prev: PlanState,
  course: CourseOffering,
  selectedOptionId: string | null,
): PlanState {
  const hue = pickHue(prev.entries.length);
  return {
    ...prev,
    entries: [...prev.entries, { course, selectedOptionId, color: String(hue) }],
  };
}

export function usePlan() {
  const bootRef = useRef<ReturnType<typeof initialState> | null>(null);
  if (bootRef.current === null) bootRef.current = initialState();
  const [pool, setPool] = useState<CourseOffering[]>(bootRef.current.pool);
  const [termsState, setTermsState] = useState<TermsState>(bootRef.current.terms);
  const [pendingQueue, setPendingQueue] = useState<{ course: CourseOffering; optionId: string }[]>([]);
  // A plan someone else sent (share link or imported JSON). Lives in its own slot,
  // shown read-only — it can never overwrite any of the user's plans.
  const [received, setReceived] = useState<ReceivedPlan | null>(loadReceived);
  const [viewing, setViewing] = useState<Viewing>(() =>
    loadReceived() ? loadViewing() : 'mine',
  );
  // Latest pool/terms for effects that must not re-subscribe on every edit.
  const poolRef = useRef(pool);
  const termsRef = useRef(termsState);
  useEffect(() => {
    poolRef.current = pool;
    termsRef.current = termsState;
  }, [pool, termsState]);

  // One-time: tell the extension to release captured data the archive sweep dropped.
  useEffect(() => {
    postForgetCourses(bootRef.current?.forgetModuleIds ?? []);
  }, []);

  // The plan every existing action/selector works on = the ACTIVE named plan of
  // the ACTIVE TERM's workspace.
  const workspace = activeWorkspace(termsState);
  const plansState = workspace.plans;
  const active = activePlan(plansState);
  const plan = active.plan;
  const archived = useMemo(
    () => isArchived(workspace.term, new Date()),
    [workspace.term],
  );

  /** Route a PlanState update into the active plan of the active term. Archived terms are frozen. */
  const setPlan = useCallback((update: (prev: PlanState) => PlanState) => {
    setTermsState((s) => {
      const ws = activeWorkspace(s);
      if (isArchived(ws.term, new Date())) return s;
      return updateWorkspace(s, s.activeTermKey, (ps) =>
        updateActivePlan(ps, update, new Date().toISOString()),
      );
    });
  }, []);

  /** Same guard for plans-level ops (create/rename/duplicate/delete/browsed). */
  const setPlans = useCallback((update: (ps: PlansState) => PlansState) => {
    setTermsState((s) => {
      const ws = activeWorkspace(s);
      if (isArchived(ws.term, new Date())) return s;
      return updateWorkspace(s, s.activeTermKey, update);
    });
  }, []);

  const switchViewing = useCallback((v: Viewing) => {
    setViewing(v);
    saveViewing(v);
  }, []);

  // A share link's #p=… is consumed ONCE into the received slot, then stripped from
  // the address bar (leaving it would pin every reload to that snapshot). The user's
  // own plan is untouched — the shared plan opens read-only alongside it. Also runs
  // on hashchange: pasting a link into an already-open planner tab doesn't reload.
  useEffect(() => {
    const consume = () => {
      const intent = readHash(window.location.hash, {
        plans: Object.values(termsRef.current.terms).flatMap((ws) => ws.plans.plans.map((p) => p.plan)),
        syncedToken: loadSyncedToken(),
      });
      // Our own mirror — including a bookmark minted before the #m= split. The copy
      // saved on this device wins; the mirror effect below rewrites the hash from it.
      if (intent.kind !== 'shared') return;
      const rec: ReceivedPlan = {
        plan: intent.plan,
        source: 'link',
        receivedAt: new Date().toISOString(),
      };
      saveReceived(rec);
      setReceived(rec);
      switchViewing('received');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    consume();
    window.addEventListener('hashchange', consume);
    return () => window.removeEventListener('hashchange', consume);
  }, [switchViewing]);

  // Mirror the ACTIVE plan into the address bar as a #m=<full token> so the
  // browser's own "send this tab to your device" / bookmark sync always carry
  // the latest plan. The `#m=` key is what marks it as ours — a bookmark opens
  // in a fresh tab, so nothing per-tab could ever do that job. Depends on
  // `received` too: after consuming a foreign hash we restore our own hash
  // right away.
  useEffect(() => {
    if (plan.entries.length === 0) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }
    window.history.replaceState(null, '', `#${planToMirrorHash(plan)}`);
  }, [plan, received]);

  // Persist the terms container on change. No first-render skip: loading and
  // migration happen synchronously in the same initializer, so the first write
  // is exactly what was loaded — and it makes a fresh migration (or an archive
  // sweep that changed nothing else) durable without waiting for an edit.
  useEffect(() => {
    saveTerms(termsState);
  }, [termsState]);

  // Persist the browsed pool so the "Browsed — not yet added" list survives reloads.
  useEffect(() => {
    savePool(pool);
  }, [pool]);

  // ---- term switching ----------------------------------------------------
  const switchTerm = useCallback((key: TermKey) => {
    setTermsState((s) => switchTermIn(s, key));
    switchViewing('mine');
  }, [switchViewing]);

  const termList = useMemo(() => Object.values(termsState.terms).map((ws) => ws.term), [termsState]);

  /** Add a course to the plan (default to its first option); no-op if already added. */
  const addCourse = useCallback((course: CourseOffering) => {
    setPlans((ps) => {
      const withEntry = updateActivePlan(ps, (prev) => {
        if (prev.entries.some((e) => e.course.id === course.id)) return prev;
        return appendEntry(prev, course, course.options[0]?.id ?? null);
      }, new Date().toISOString());
      return addBrowsed(withEntry, withEntry.activeId, [course.id], new Date().toISOString());
    });
  }, [setPlans]);

  /** Add into the course's OWN term (creating it if needed), into `planId` or that term's active plan. */
  const addIntoTerm = useCallback((course: CourseOffering, optionId: string, planId: string | null) => {
    const nowIso = new Date().toISOString();
    setTermsState((s) => {
      const key = termKey(course.term);
      let next = ensureWorkspace(s, course.term, nowIso);
      next = updateWorkspace(next, key, (ps) => {
        let out = planId ? switchActive(ps, planId) : ps;
        out = updateActivePlan(out, (prev) => {
          const existing = prev.entries.find((e) => e.course.id === course.id);
          if (existing) {
            return {
              ...prev,
              entries: prev.entries.map((e) =>
                e.course.id === course.id ? { ...e, course, selectedOptionId: optionId } : e,
              ),
            };
          }
          return appendEntry(prev, course, optionId);
        }, nowIso);
        return addBrowsed(out, out.activeId, [course.id], nowIso);
      });
      return switchTermIn(next, key);
    });
  }, []);

  /**
   * Add a course with a specific option pre-selected, or — if it's already in the
   * plan — switch it to that option. Also merges the (fresh) course into the pool.
   * This is the `plan-add` direct path and the "+" quick-add can reuse it too.
   */
  const addCourseWithOption = useCallback((course: CourseOffering, optionId: string) => {
    setPool((prev) => mergeCourses(prev, [course]));
    addIntoTerm(course, optionId, null);
  }, [addIntoTerm]);

  // ---- plan-add picker queue (course's term has several plans) -----------
  const pendingAdd = pendingQueue[0] ?? null;
  const confirmPendingAdd = useCallback((planId: string) => {
    const head = pendingQueue[0];
    if (!head) return;
    addIntoTerm(head.course, head.optionId, planId);
    setPendingQueue((q) => q.slice(1));
  }, [pendingQueue, addIntoTerm]);
  const cancelPendingAdd = useCallback(() => {
    const head = pendingQueue[0];
    if (!head) return;
    // The capture still happened — keep it as a browsed record in that term's active plan.
    const nowIso = new Date().toISOString();
    setTermsState((s) => {
      const key = termKey(head.course.term);
      const next = ensureWorkspace(s, head.course.term, nowIso);
      return updateWorkspace(next, key, (ps) => addBrowsed(ps, ps.activeId, [head.course.id], nowIso));
    });
    setPendingQueue((q) => q.slice(1));
  }, [pendingQueue]);

  const removeCourse = useCallback((courseId: string) => {
    setPlan((prev) => ({
      ...prev,
      entries: prev.entries.filter((e) => e.course.id !== courseId),
    }));
  }, [setPlan]);

  const selectOption = useCallback((courseId: string, optionId: string) => {
    setPlan((prev) => ({
      ...prev,
      entries: prev.entries.map((e) =>
        e.course.id === courseId ? { ...e, selectedOptionId: optionId } : e,
      ),
    }));
  }, [setPlan]);

  const replacePlan = useCallback(
    (next: PlanState) => {
      // Any courses referenced by the imported plan should also exist in the pool.
      setPool((prev) => mergeCourses(prev, next.entries.map((e) => e.course)));
      setPlan(() => next);
    },
    [setPlan],
  );

  const resetPlan = useCallback(() => {
    setPlan((prev) => emptyPlan(prev.term));
  }, [setPlan]);

  // ---- named-plans management -------------------------------------------
  // switchPlan must work in archived terms too: viewing another archived plan
  // is read-only navigation, not an edit — so no archived guard here.
  const switchPlan = useCallback(
    (id: string) => {
      setTermsState((s) => updateWorkspace(s, s.activeTermKey, (ps) => switchActive(ps, id)));
      switchViewing('mine');
    },
    [switchViewing],
  );

  const createNewPlan = useCallback(() => {
    setPlans((s) => createPlan(s, new Date().toISOString()));
    switchViewing('mine');
  }, [setPlans, switchViewing]);

  const renamePlan = useCallback((id: string, name: string) => {
    setPlans((s) => renamePlanIn(s, id, name));
  }, [setPlans]);

  const duplicatePlan = useCallback(
    (id: string) => {
      setPlans((s) => duplicatePlanIn(s, id, new Date().toISOString()));
      switchViewing('mine');
    },
    [setPlans, switchViewing],
  );

  const deletePlan = useCallback((id: string) => {
    setPlans((s) => deletePlanIn(s, id));
  }, [setPlans]);

  /** Keep the received plan as a NEW named plan ("朋友的plan") in ITS OWN term and switch to it. */
  const saveReceivedAsNewPlan = useCallback(
    (name: string) => {
      if (!received) return;
      const incoming = received.plan;
      setPool((prev) => mergeCourses(prev, incoming.entries.map((e) => e.course)));
      const nowIso = new Date().toISOString();
      setTermsState((s) => {
        const key = termKey(incoming.term);
        let next = ensureWorkspace(s, incoming.term, nowIso);
        next = updateWorkspace(next, key, (ps) => {
          const withPlan = addPlan(ps, incoming, name, nowIso);
          return addBrowsed(withPlan, withPlan.activeId, incoming.entries.map((e) => e.course.id), nowIso);
        });
        return switchTermIn(next, key);
      });
      clearReceived();
      setReceived(null);
      switchViewing('mine');
    },
    [received, switchViewing],
  );

  /** Replace the ACTIVE plan with the received one (destructive — caller confirms). */
  const saveReceivedAsMine = useCallback(() => {
    if (received && termKey(received.plan.term) !== termsRef.current.activeTermKey) {
      // Different term: replacing the current term's plan with it would corrupt both.
      saveReceivedAsNewPlan('Shared plan');
      return;
    }
    if (received) replacePlan(received.plan);
    clearReceived();
    setReceived(null);
    switchViewing('mine');
  }, [received, replacePlan, switchViewing, saveReceivedAsNewPlan]);

  /** Drop the received plan and go back to my own. */
  const discardReceived = useCallback(() => {
    clearReceived();
    setReceived(null);
    switchViewing('mine');
  }, [switchViewing]);

  /** Drop a browsed course from THIS plan's own list (per-plan, per-term). */
  const removeFromPool = useCallback((courseId: string) => {
    setPlans((ps) => removeBrowsed(ps, [courseId], new Date().toISOString()));
  }, [setPlans]);

  /** Clear this plan's browsed list — added courses keep their membership. */
  const clearBrowsed = useCallback(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    const ids = (active.browsed ?? []).filter((id) => !added.has(id));
    setPlans((ps) => removeBrowsed(ps, ids, new Date().toISOString()));
  }, [plan, active, setPlans]);

  /** Manual "I'm enrolled" toggle — acts on the course's OWN term, frozen when archived. */
  const toggleBooked = useCallback((course: CourseOffering) => {
    setTermsState((s) => {
      if (isArchived(course.term, new Date())) return s;
      const key = termKey(course.term);
      const ws = s.terms[key];
      if (!ws) return s;
      const next = toggleBookedIn(ws, course.id);
      return next === ws ? s : { ...s, terms: { ...s.terms, [key]: next } };
    });
  }, []);

  // True once the extension's bridge has delivered anything this session — used to
  // route "open in TSS" through the extension (which can reuse an open TSS tab).
  // Mirrored into state because the UI also renders off it (the booked-sync prompt
  // only makes sense to someone who actually has the extension).
  const bridgeSeen = useRef(false);
  const [extensionSeen, setExtensionSeen] = useState(false);
  // When TSS last reported the booked list. Session state, not persisted: the bridge
  // re-pushes it on every planner load, so there is nothing to remember across one.
  const [bookedAt, setBookedAt] = useState<string | null>(null);
  // The last push VERBATIM, every term of it. bookedIds is narrowed to the term on
  // screen, which cannot tell "TSS says you have none" apart from "TSS says you have
  // three, in a term you aren't looking at" — and those need different answers.
  const [bookedRows, setBookedRows] = useState<BookedModule[]>([]);
  const markBridgeSeen = useCallback(() => {
    bridgeSeen.current = true;
    setExtensionSeen(true);
  }, []);

  // Data bridge: `courses` routes into each course's own term; `plan-add` adds to
  // the course's term (via the picker when that term has several plans).
  useEffect(() => {
    return installBridgeListener({
      onCourses: (incoming) => {
        markBridgeSeen();
        const prevPool = poolRef.current;
        setPool(mergeCourses(prevPool, incoming));
        setTermsState((s) => {
          const nowIso = new Date().toISOString();
          const routed = routeCapture(s, prevPool, incoming, nowIso, new Date());
          // EVERY plan holds its own course copies — refresh them all, or seat
          // counts stay frozen at whatever they were when the course was added.
          const refreshed = mapWorkspaces(routed.state, (ws) =>
            isArchived(ws.term, new Date())
              ? ws.plans // archived terms are frozen — no seat refreshes
              : mapAllPlans(ws.plans, (p) => refreshPlanEntries(p, incoming), nowIso),
          );
          return routed.switchTo ? switchTermIn(refreshed, routed.switchTo) : refreshed;
        });
      },
      onPlanAdd: (course, optionId) => {
        markBridgeSeen();
        if (isArchived(course.term, new Date())) return; // defensive: cannot add into an archive
        setPool((prev) => mergeCourses(prev, [course]));
        const ws = termsRef.current.terms[termKey(course.term)];
        if (ws && ws.plans.plans.length > 1) {
          setPendingQueue((q) => [...q, { course, optionId }]);
        } else {
          addIntoTerm(course, optionId, null);
        }
        // Adds always land in MY plans — surface them, even if a received plan was up.
        switchViewing('mine');
      },
      onBooked: (rows, capturedAt, captured) => {
        markBridgeSeen();
        // The extension holds no capture. Anything this device remembers about a sync
        // came from a push it can no longer stand behind, so drop that memory rather
        // than go on asserting it — the student's own marks are untouched.
        if (captured === false) {
          setBookedAt(null);
          setBookedRows([]);
          setTermsState((s) => {
            let changed = false;
            const terms: typeof s.terms = {};
            for (const [key, ws] of Object.entries(s.terms)) {
              const next = forgetAutoBooked(ws);
              if (next !== ws) changed = true;
              terms[key] = next;
            }
            return changed ? { ...s, terms } : s;
          });
          return;
        }
        setBookedAt(capturedAt ?? null);
        setBookedRows(rows);
        setTermsState((s) => {
          const nowIso = new Date().toISOString();
          const now = new Date();
          // The payload is the FULL current booking list across terms.
          const idsByKey = new Map<string, string[]>();
          for (const r of rows) {
            const key = termKey(r.term);
            const id = `${r.courseCode}|${r.term.year}|${r.term.period}`;
            idsByKey.set(key, [...(idsByKey.get(key) ?? []), id]);
          }
          // Terms with bookings the student never browsed get a workspace
          // (background data — never auto-switch the active term).
          let next = s;
          for (const r of rows) {
            if (!isArchived(r.term, now)) next = ensureWorkspace(next, r.term, nowIso);
          }
          // Every non-archived workspace gets its slice — [] clears (a drop, or a
          // feed with zero bookings for that term).
          let changed = next !== s;
          const terms: typeof next.terms = {};
          for (const [key, ws] of Object.entries(next.terms)) {
            if (isArchived(ws.term, now)) { terms[key] = ws; continue; }
            const applied = applyAutoBooked(ws, idsByKey.get(key) ?? []);
            if (applied !== ws) changed = true;
            terms[key] = applied;
          }
          return changed ? { ...next, terms } : s;
        });
      },
    });
  }, [addIntoTerm, markBridgeSeen, switchViewing]);

  /** Jump back to TSS — through the extension when present, else a plain new tab. */
  const openCourseInTss = useCallback((course: CourseOffering) => {
    openInTss(course, bridgeSeen.current);
  }, []);

  /** Open a section's booking page (the extension reuses the one booking tab). */
  const openBookingInTss = useCallback((course: CourseOffering, option: SectionOption) => {
    openBooking(course, option, bridgeSeen.current);
  }, []);

  /** "Check bookings" — the TSS home page is the only page that reports them. */
  const checkBookings = useCallback(() => {
    openTssHome(bridgeSeen.current);
  }, []);

  // ---- derived view data (memoized) --------------------------------------
  // Everything the screen shows derives from the plan being VIEWED — the user's
  // own, or a received one (read-only). Archived terms are read-only too.
  const viewPlan = viewing === 'received' && received ? received.plan : plan;
  const readOnly = (viewing === 'received' && received !== null) || archived;

  /** Booked (enrolled) course ids of the VIEWED plan's own term. */
  const bookedIds = useMemo<ReadonlySet<string>>(() => {
    const ws = termsState.terms[termKey(viewPlan.term)];
    return ws ? bookedSet(ws) : new Set<string>();
  }, [termsState, viewPlan.term]);

  /**
   * What TSS ITSELF reported for the viewed term this session, before any of the
   * student's own marks and unmarks. Only `bookedIds` decides how a course reads; this
   * exists so a card can show that an unmark is standing against a live report, rather
   * than leaving the student to wonder why TSS "forgot" a course they are enrolled in.
   */
  const tssBookedIds = useMemo<ReadonlySet<string>>(() => {
    const t = viewPlan.term;
    return new Set(
      bookedRows
        .filter((r) => r.term.year === t.year && r.term.period === t.period)
        .map((r) => `${r.courseCode}|${r.term.year}|${r.term.period}`),
    );
  }, [bookedRows, viewPlan.term]);

  /**
   * Per course id, the events TSS says the student is enrolled in — the raw material
   * for "your plan is on a different section than you booked". Keyed off the viewed
   * term, like every other booked reading.
   */
  const enrolledEventIds = useMemo<ReadonlyMap<string, string[]>>(() => {
    const t = viewPlan.term;
    const out = new Map<string, string[]>();
    for (const r of bookedRows) {
      if (r.term.year !== t.year || r.term.period !== t.period) continue;
      if (r.eventIds && r.eventIds.length) {
        out.set(`${r.courseCode}|${r.term.year}|${r.term.period}`, r.eventIds);
      }
    }
    return out;
  }, [bookedRows, viewPlan.term]);

  /** Whether TSS has ever reported this term's bookings — drives the sync prompt. */
  const bookedSynced = useMemo<boolean>(() => {
    const ws = termsState.terms[termKey(viewPlan.term)];
    return ws !== undefined && isAutoBookedSynced(ws);
  }, [termsState, viewPlan.term]);

  const selectedCourses = useMemo(() => buildSelectedCourses(viewPlan), [viewPlan]);
  const weeklyConflicts = useMemo(() => findWeeklyConflicts(selectedCourses), [selectedCourses]);
  const finalConflicts = useMemo(() => findFinalConflicts(selectedCourses), [selectedCourses]);
  const conflictedCourseIds = useMemo(
    () => courseIdsInConflicts([...weeklyConflicts, ...finalConflicts]),
    [weeklyConflicts, finalConflicts],
  );

  const instances = useMemo(() => meetingInstances(viewPlan, bookedIds), [viewPlan, bookedIds]);
  const finals = useMemo(() => finalsSorted(viewPlan, bookedIds), [viewPlan, bookedIds]);
  const midterms = useMemo(() => midtermsSorted(viewPlan, bookedIds), [viewPlan, bookedIds]);
  const units = useMemo(() => planUnits(viewPlan), [viewPlan]);

  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of viewPlan.entries) m.set(e.course.id, e.course.courseCode);
    return m;
  }, [viewPlan]);

  /** Resolve a course by id (pool + viewed plan) — used for TSS jump-back from a block. */
  const courseById = useMemo(() => {
    const m = new Map<string, CourseOffering>();
    for (const c of pool) m.set(c.id, c);
    for (const e of viewPlan.entries) m.set(e.course.id, e.course);
    return m;
  }, [pool, viewPlan]);

  /** THIS plan's browsed list, minus courses already added, resolved from the pool repository. */
  const browsedNotAdded = useMemo(() => {
    const added = new Set(plan.entries.map((e) => e.course.id));
    const byId = new Map(pool.map((c) => [c.id, c]));
    return (active.browsed ?? [])
      .filter((id) => !added.has(id))
      .map((id) => byId.get(id))
      .filter((c): c is CourseOffering => c !== undefined);
  }, [pool, plan, active]);

  return {
    pool,
    plan,
    addCourse,
    addCourseWithOption,
    removeCourse,
    selectOption,
    replacePlan,
    resetPlan,
    removeFromPool,
    clearBrowsed,
    bookedIds,
    tssBookedIds,
    enrolledEventIds,
    bookedSynced,
    bookedAt,
    bookedRows,
    extensionSeen,
    checkBookings,
    toggleBooked,
    openCourseInTss,
    openBookingInTss,
    // terms
    activeTermKey: termsState.activeTermKey,
    termList,
    archived,
    switchTerm,
    // plan-add picker — lists the plans of the COURSE's term, not the viewed term
    pendingAdd,
    pendingAddPlans:
      pendingAdd === null
        ? []
        : (termsState.terms[termKey(pendingAdd.course.term)]?.plans.plans ?? []).map((p) => ({
            id: p.id, name: p.name, count: p.plan.entries.length,
          })),
    confirmPendingAdd,
    cancelPendingAdd,
    // named plans
    plans: plansState.plans,
    activePlanId: plansState.activeId,
    activePlanName: active.name,
    switchPlan,
    createNewPlan,
    renamePlan,
    duplicatePlan,
    deletePlan,
    // received plans (share links / imported JSON) — read-only companion slot
    received,
    viewing,
    viewPlan,
    readOnly,
    switchViewing,
    saveReceivedAsMine,
    saveReceivedAsNewPlan,
    discardReceived,
    // derived
    selectedCourses,
    weeklyConflicts,
    finalConflicts,
    conflictedCourseIds,
    instances,
    finals,
    midterms,
    units,
    codeById,
    courseById,
    browsedNotAdded,
  };
}

export type PlanController = ReturnType<typeof usePlan>;

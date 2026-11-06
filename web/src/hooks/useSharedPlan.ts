/**
 * Live state of a plan opened from a share link: loads it, polls the version while the
 * tab is visible, and applies section switches optimistically. The server is last-write-wins,
 * so whatever the server says after a write is the truth and replaces local guesses.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applySelection, type PlanState } from '@triton/shared';
import { fetchSharedPlan, fetchSharedVersion, selectSharedOption, type SharedDoc } from '../lib/cloud/api';

export type SharedPlanStatus =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'gone' }
  | { kind: 'ready'; name: string; plan: PlanState; version: number; expiresAt: string };

export interface SharedPlan {
  status: SharedPlanStatus;
  select: (courseId: string, optionId: string) => void;
  retry: () => void;
}

export function useSharedPlan(code: string, opts?: { pollMs?: number }): SharedPlan {
  const pollMs = opts?.pollMs ?? 4000;
  const [status, setStatus] = useState<SharedPlanStatus>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const selectRef = useRef<(courseId: string, optionId: string) => void>(() => {});

  useEffect(() => {
    // Everything below is scoped to one (code, attempt): `dead` drops any answer that lands after it ends.
    let dead = false;
    let held: SharedDoc | null = null; // what the screen shows, optimistic edits included
    let server: SharedDoc | null = null; // last state the server confirmed
    let inflight = 0; // selects posted but not answered
    let stale = false; // a newer server doc is wanted but couldn't be adopted yet
    let polling = false;
    let loading = false;
    setStatus({ kind: 'loading' });

    const show = () => {
      if (held) setStatus({ kind: 'ready', name: held.name, plan: held.plan, version: held.version, expiresAt: held.expiresAt });
    };
    const gone = () => {
      dead = true;
      clearInterval(timer);
      setStatus({ kind: 'gone' });
    };

    const refetch = async () => {
      if (loading) { stale = true; return; }
      loading = true;
      const doc = await fetchSharedPlan(code);
      loading = false;
      if (dead) return;
      if (doc === 'not-found') return gone();
      if (doc === null) {
        if (!held) setStatus({ kind: 'offline' });
        else stale = true; // transient; the next poll retries
        return;
      }
      // Adopting now would wipe an optimistic switch whose POST hasn't answered; settle() retries.
      if (inflight > 0) { stale = true; return; }
      stale = false;
      held = server = doc;
      show();
    };

    const settle = () => {
      if (inflight === 0 && stale) void refetch();
    };

    const poll = async () => {
      if (polling || dead || !held || document.visibilityState !== 'visible') return;
      polling = true;
      const v = await fetchSharedVersion(code);
      polling = false;
      if (dead) return;
      if (v === 'not-found') return gone();
      if (v === null) return;
      if (held && (stale || v > held.version)) await refetch();
    };

    selectRef.current = (courseId, optionId) => {
      if (dead || !held || !server) return;
      const next = applySelection(held.plan, courseId, optionId);
      if (!next) return;
      held = { ...held, plan: next };
      show();
      inflight++;
      void selectSharedOption(code, courseId, optionId).then((res) => {
        inflight--;
        if (dead) return;
        if (res === 'not-found') return gone();
        if (res === null || res === 'invalid') {
          // The server didn't take it: go back to what it last confirmed, then ask what it holds now.
          if (server) held = { ...(held ?? server), plan: server.plan };
          stale = true;
          if (inflight === 0) { show(); settle(); }
          return;
        }
        if (server && held) {
          const prev = server.version;
          const confirmed = applySelection(server.plan, courseId, optionId);
          server = { ...server, plan: confirmed ?? server.plan, version: res };
          held = { ...held, version: res };
          // Anything but prev+1 means someone else wrote in between, so our plan isn't version `res`.
          if (res !== prev + 1) stale = true;
        }
        if (inflight === 0) show();
        settle();
      });
    };

    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void poll(), pollMs);
    void refetch();

    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      selectRef.current = () => {};
    };
  }, [code, pollMs, attempt]);

  const select = useCallback((courseId: string, optionId: string) => selectRef.current(courseId, optionId), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, select, retry };
}

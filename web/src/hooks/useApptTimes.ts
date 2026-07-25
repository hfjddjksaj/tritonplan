import { useEffect, useState } from 'react';
import type { ApptTimes } from '@triton/shared';
import { installApptTimesListener } from '../lib/bridge';
import { loadApptTimes, saveApptTimes } from '../lib/storage';

/** The student's own appointment times: hydrated from localStorage, live-updated
 *  by extension pushes (which are also persisted). Global — independent of plans
 *  and of the received/read-only view. */
export function useApptTimes(): ApptTimes[] {
  const [appt, setAppt] = useState<ApptTimes[]>(() => loadApptTimes() ?? []);
  useEffect(() => {
    return installApptTimesListener((incoming) => {
      if (incoming.length === 0) return; // defense-in-depth: a push never wipes
      setAppt(incoming);
      saveApptTimes(incoming);
    });
  }, []);
  return appt;
}

import { useEffect, useRef, useState } from 'react';
import { mergeApptTimes, type ApptTimes } from '@triton/shared';
import { installApptTimesListener } from '../lib/bridge';
import type { CloudBoot } from '../lib/cloud/boot';

/** The student's own appointment times: loaded from the account, live-updated
 *  by extension pushes (which the sync engine saves back). Global — independent
 *  of plans and of the received/read-only view. */
export function useApptTimes(boot: CloudBoot): ApptTimes[] {
  const [appt, setAppt] = useState<ApptTimes[]>(() => boot.appt ?? []);
  const current = useRef(appt);
  useEffect(() => {
    return installApptTimesListener((incoming) => {
      if (incoming.length === 0) return; // defense-in-depth: a push never wipes
      // Another device may have captured other terms: merge per term, never overwrite.
      const merged = mergeApptTimes(current.current, incoming);
      current.current = merged;
      setAppt(merged);
      boot.engine.setAppt(merged);
    });
  }, [boot.engine]);
  return appt;
}

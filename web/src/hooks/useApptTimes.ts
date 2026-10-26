import { useEffect, useState } from 'react';
import type { ApptTimes } from '@triton/shared';
import { installApptTimesListener } from '../lib/bridge';
import type { CloudBoot } from '../lib/cloud/boot';

/** The student's own appointment times: loaded from the account, live-updated
 *  by extension pushes (which the sync engine saves back). Global — independent
 *  of plans and of the received/read-only view. */
export function useApptTimes(boot: CloudBoot): ApptTimes[] {
  const [appt, setAppt] = useState<ApptTimes[]>(() => boot.appt ?? []);
  useEffect(() => {
    return installApptTimesListener((incoming) => {
      if (incoming.length === 0) return; // defense-in-depth: a push never wipes
      setAppt(incoming);
      boot.engine.setAppt(incoming);
    });
  }, [boot.engine]);
  return appt;
}

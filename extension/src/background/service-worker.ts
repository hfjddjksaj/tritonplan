/**
 * Background service worker — owns the CaptureStore and routes extension-internal
 * messages. MV3 workers are non-persistent, so we lazily (re)load the store from
 * chrome.storage.local on every handler and persist after each ingest.
 *
 * ⛔ NO-BAN RED LINE: this worker never contacts TSS. It only stores bodies the page
 * already fetched (handed over by tss-relay) and coordinates OUR planner tab.
 */

import { CaptureStore } from '../lib/capture-to-courses.js';
import {
  MSG,
  PLANNER_URL,
  PLANNER_MATCH,
  type PlanAddIntent,
} from '../config.js';
import type { CourseOffering } from '@triton/shared';

const STORE_KEY = 'tp:store';
const QUEUE_KEY = 'tp:pendingPlanAdds';

/* ---- Store (lazy singleton, reloaded across worker wakeups) --------------- */
let storePromise: Promise<CaptureStore> | null = null;

async function getStore(): Promise<CaptureStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const data = await chrome.storage.local.get(STORE_KEY);
      return CaptureStore.deserialize(data?.[STORE_KEY]);
    })();
  }
  return storePromise;
}

async function persist(store: CaptureStore): Promise<void> {
  await chrome.storage.local.set({ [STORE_KEY]: store.serialize() });
}

/* ---- Plan-add queue (persisted so it survives worker eviction) ------------ */
async function enqueuePlanAdd(intent: PlanAddIntent): Promise<void> {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  const queue: PlanAddIntent[] = Array.isArray(data?.[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  queue.push(intent);
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function drainPlanAdds(): Promise<PlanAddIntent[]> {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  const queue: PlanAddIntent[] = Array.isArray(data?.[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  if (queue.length) await chrome.storage.local.set({ [QUEUE_KEY]: [] });
  return queue;
}

/* ---- Planner tab helpers -------------------------------------------------- */
async function openOrFocusPlanner(): Promise<chrome.tabs.Tab | undefined> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: PLANNER_MATCH });
  } catch {
    tabs = [];
  }
  const existing = tabs.find((t) => t.id != null);
  if (existing && existing.id != null) {
    try {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
    } catch {
      /* ignore focus errors */
    }
    return existing;
  }
  try {
    return await chrome.tabs.create({ url: PLANNER_URL });
  } catch {
    return undefined;
  }
}

/* ---- Message router ------------------------------------------------------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  switch (msg.type) {
    case MSG.INGEST: {
      const body = typeof msg.body === 'string' ? msg.body : '';
      const url = typeof msg.url === 'string' ? msg.url : undefined;
      (async () => {
        try {
          if (body) {
            const store = await getStore();
            if (store.ingestBody(body, url)) await persist(store);
          }
          sendResponse({ ok: true });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true; // async
    }

    case MSG.GET_COURSES: {
      (async () => {
        try {
          const store = await getStore();
          const courses: CourseOffering[] = store.toCourses();
          sendResponse(courses);
        } catch {
          sendResponse([]);
        }
      })();
      return true;
    }

    case MSG.PLAN_ADD: {
      const course = msg.course as CourseOffering | undefined;
      const selectedOptionId = typeof msg.selectedOptionId === 'string' ? msg.selectedOptionId : '';
      (async () => {
        try {
          if (course && selectedOptionId) {
            await enqueuePlanAdd({ course, selectedOptionId });
            const tab = await openOrFocusPlanner();
            // If a planner tab was already open, ping it to flush now. A freshly
            // created tab will flush itself on load, so a failure here is harmless.
            if (tab?.id != null) {
              try {
                await chrome.tabs.sendMessage(tab.id, { type: MSG.FLUSH });
              } catch {
                /* content script not ready yet — its onload sync handles it */
              }
            }
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false });
          }
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    case MSG.OPEN_PLANNER: {
      (async () => {
        await openOrFocusPlanner();
        sendResponse({ ok: true });
      })();
      return true;
    }

    case MSG.DRAIN_PLAN_ADDS: {
      (async () => {
        try {
          sendResponse(await drainPlanAdds());
        } catch {
          sendResponse([]);
        }
      })();
      return true;
    }

    default:
      return false;
  }
});

/**
 * Background service worker — owns the CaptureStore and routes extension-internal
 * messages. MV3 workers are non-persistent, so we lazily (re)load the store from
 * chrome.storage.local on every handler and persist after each ingest.
 *
 * ⛔ NO-BAN RED LINE: this worker never contacts TSS. It only stores bodies the page
 * already fetched (handed over by tss-relay) and coordinates OUR planner tab.
 */

import { CaptureStore } from '../lib/capture-to-courses.js';
import { extractModuleRef } from '../lib/tss-dom.js';
import {
  MSG,
  PLANNER_URL,
  PLANNER_MATCH,
  TSS_URL_PREFIX,
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

/** Hash-route prefix of TSS booking/module-display tabs (its own "Go To Booking" opens these). */
const BOOKING_HASH = '#ZUSModule-display';

async function queryTssTabs(): Promise<chrome.tabs.Tab[]> {
  try {
    return await chrome.tabs.query({ url: `${TSS_URL_PREFIX}*` });
  } catch {
    return [];
  }
}

async function focusTab(tab: chrome.tabs.Tab, url?: string): Promise<void> {
  if (tab.id == null) return;
  await chrome.tabs.update(tab.id, url === undefined ? { active: true } : { active: true, url });
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

/**
 * Jump back to TSS for a course: focus the tab already showing that EXACT module
 * (matched by ModuleID in the URL); otherwise open a fresh tab. Tabs on other
 * courses, search views, or bookings are deliberately never repurposed.
 * User-driven navigation only — never fetches or automates.
 */
async function openOrFocusTss(url: string, moduleId: string): Promise<void> {
  const tabs = await queryTssTabs();
  const onModule = moduleId
    ? tabs.find((t) => t.url != null && extractModuleRef(t.url)?.moduleId === moduleId)
    : undefined;
  if (onModule && onModule.id != null) {
    try {
      await focusTab(onModule);
      return;
    } catch {
      /* tab vanished between query and update — fall through to create */
    }
  }
  try {
    await chrome.tabs.create({ url });
  } catch {
    /* ignore */
  }
}

/**
 * Open a booking page. Like TSS's own "Go To Booking", booking lives in its own tab —
 * but repeat bookings reuse that one tab (navigating it, or reloading when it's
 * already on the same section, so seat counts refresh) instead of piling up tabs.
 */
async function openOrReuseBookingTab(url: string): Promise<void> {
  const tabs = await queryTssTabs();
  const booking = tabs.find((t) => t.id != null && (t.url ?? '').includes(BOOKING_HASH));
  if (booking && booking.id != null) {
    try {
      if (booking.url === url) {
        await focusTab(booking);
        await chrome.tabs.reload(booking.id);
      } else {
        await focusTab(booking, url);
      }
      return;
    } catch {
      /* fall through to create */
    }
  }
  try {
    await chrome.tabs.create({ url });
  } catch {
    /* ignore */
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

    case MSG.OPEN_TSS:
    case MSG.OPEN_BOOKING: {
      const url = typeof msg.url === 'string' ? msg.url : '';
      const moduleId = typeof msg.moduleId === 'string' ? msg.moduleId : '';
      (async () => {
        if (url.startsWith(TSS_URL_PREFIX)) {
          if (msg.type === MSG.OPEN_BOOKING) await openOrReuseBookingTab(url);
          else await openOrFocusTss(url, moduleId);
          sendResponse({ ok: true });
        } else {
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

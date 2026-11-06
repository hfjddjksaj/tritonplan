/**
 * Which open tabs count as "the planner". A shared-plan page lives on the same
 * origin but is a viewer, so it must never be focused or sent courses.
 *
 * ⛔ NO-BAN RED LINE: pure list filtering over our own tabs; no TSS traffic.
 */

import { isSharedPlanUrl } from '../config.js';

export function plannerTabsOnly(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return tabs.filter((t) => !isSharedPlanUrl(t.url));
}

export function pickPlannerTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined {
  return plannerTabsOnly(tabs).find((t) => t.id != null);
}

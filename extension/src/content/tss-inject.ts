/**
 * tss-inject — ISOLATED-world content script on TSS.
 *
 * Injects a passive "+ TritonPlan" overlay button into each booking-package card in the
 * Class Sections UI. Clicking it ONLY reads already-captured data and sends a `plan-add`
 * intent to our background worker (which opens OUR planner). It NEVER clicks TSS controls,
 * NEVER triggers a TSS network call — see the no-ban red line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SELECTORS ASSUMED FROM RECON — VERIFY LIVE (no logged-in TSS was available).
 *  TSS is SAPUI5/Fiori; class names are generated and may differ. Everything below
 *  degrades gracefully: if a selector matches nothing, we simply inject no button and
 *  never throw into the page. Tune the constants here after inspecting a live DOM.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PRODUCT_NAME, MSG } from '../config.js';
import {
  extractModuleRef,
  findCourseByModuleId,
  parseEnrollCode,
  parsePackageLabel,
  resolveOption,
  type DisplayedCard,
} from '../lib/tss-dom.js';
import type { CourseOffering } from '@triton/shared';

/* ===== VERIFIED LIVE SELECTORS (UCSD custom `soc*` classes on TSS) ========= *
 * Confirmed 2026-07-21 against a logged-in TSS "Class Sections" view. TSS wraps each
 * bookable package in stable UCSD-custom classes (NOT the SAP-generated `.sapM*` ones,
 * which do not match). Verified on CSE-008A (9 packages → 9 `.socPkgBlock`):
 *   `.socPkgBlock`       one card per bookable package (iterate these)
 *   `.socPkgId`          enroll code, e.g. "SE00154302"
 *   `.socPkgName`        label, e.g. "CSE-008A (P-001-001)"
 *   `.socPkgHeaderRight` header's right cell, holds the "Go To Booking" button
 * Everything degrades gracefully: if nothing matches we inject no button and never throw.
 */
const CARD_SELECTOR = '.socPkgBlock';
// Place the button at the END of the header's identity row (right of the course code +
// enroll code), NOT in the metrics/action cluster (Limit/Available/Go To Booking) — that
// side is likelier to gain future controls, so anchoring to the stable identity area avoids
// collisions with features we add later.
const HEADER_SELECTORS = ['.socPkgHeader', '.socPkgHeaderMain'];
const ENROLL_CODE_SELECTOR = '.socPkgId';
const PKG_NAME_SELECTOR = '.socPkgName';
// Marker so we never double-inject into the same card.
const INJECTED_ATTR = 'data-tritonplan-injected';
/* ========================================================================== */

const BUTTON_LABEL = `+ ${PRODUCT_NAME}`;

let cachedCourses: CourseOffering[] = [];

/** Ask the SW for captured courses (cheap; used to enable/resolve buttons). */
async function refreshCourses(): Promise<void> {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.GET_COURSES });
    if (Array.isArray(res)) cachedCourses = res as CourseOffering[];
  } catch {
    /* SW asleep / context gone — keep last cache */
  }
}

/** Read the enroll code + package label directly from a package card's soc* elements. */
function readCard(card: Element): DisplayedCard {
  const idText = (card.querySelector(ENROLL_CODE_SELECTOR)?.textContent ?? '').trim();
  const nameText = (card.querySelector(PKG_NAME_SELECTOR)?.textContent ?? '').trim();
  const blockText = (card.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Prefer the dedicated elements; fall back to scanning the whole card's text.
  const enrollCode = /^[A-Za-z]{2}\d{4,}$/.test(idText) ? idText : parseEnrollCode(blockText);
  const { packageCode } = parsePackageLabel(nameText || blockText);
  return { enrollCode, packageCode };
}

const STYLE_ID = 'tritonplan-inject-style';
// Match TSS/Fiori Horizon typography (the "72" font family) so the button reads as native,
// styled as a small accent "ghost" button — recognizably ours without clashing with TSS.
function injectStyleOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Dark navy fill matching TSS's "Go To Booking" button (rgb(39,54,123) / 8px radius, white text).
  style.textContent = [
    '.tp-plan-btn{margin-left:10px;padding:2px 10px;',
    'font:600 13px/18px "72","72full",Arial,Helvetica,sans-serif;',
    'color:#fff;background:#27367b;border:1px solid #27367b;border-radius:8px;',
    'cursor:pointer;vertical-align:middle;white-space:nowrap;transition:background .1s}',
    '.tp-plan-btn:hover{background:#1e2a63;border-color:#1e2a63}',
    '.tp-plan-btn:active{background:#18214f;border-color:#18214f}',
  ].join('');
  (document.head || document.documentElement).appendChild(style);
}

function makeButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tp-plan-btn';
  btn.textContent = BUTTON_LABEL;
  btn.setAttribute('aria-label', BUTTON_LABEL);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function flash(btn: HTMLButtonElement, text: string, ok: boolean): void {
  const prev = btn.textContent;
  btn.textContent = text;
  const c = ok ? '#2e7d32' : '#b23c3c';
  btn.style.background = c;
  btn.style.borderColor = c;
  btn.style.color = '#fff';
  setTimeout(() => {
    btn.textContent = prev;
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 1400);
}

/** Resolve the current card → {course, option} and send a plan-add intent. */
async function onAddClick(header: Element, btn: HTMLButtonElement): Promise<void> {
  const ref = extractModuleRef(location.hash || location.href);
  if (!ref) {
    flash(btn, 'No course open', false);
    return;
  }
  if (!cachedCourses.length) await refreshCourses();
  const course = findCourseByModuleId(cachedCourses, ref.moduleId);
  if (!course) {
    // Maybe not captured yet; try one refresh then bail gracefully.
    await refreshCourses();
    const retry = findCourseByModuleId(cachedCourses, ref.moduleId);
    if (!retry) {
      flash(btn, 'Browse first', false);
      return;
    }
    return finish(retry, header, btn);
  }
  return finish(course, header, btn);
}

async function finish(
  course: CourseOffering,
  header: Element,
  btn: HTMLButtonElement,
): Promise<void> {
  const card = readCard(header);
  const option = resolveOption(course, card);
  if (!option) {
    flash(btn, 'Section not found', false);
    return;
  }
  try {
    await chrome.runtime.sendMessage({
      type: MSG.PLAN_ADD,
      course,
      selectedOptionId: option.id,
    });
    flash(btn, '✓ Added', true);
  } catch {
    flash(btn, 'Error', false);
  }
}

/** The end of the header's identity row (right of the course code + enroll code). */
function injectTarget(card: Element): Element {
  const header = HEADER_SELECTORS.map((s) => card.querySelector(s)).find(Boolean) ?? null;
  const nameEl = card.querySelector(PKG_NAME_SELECTOR);
  if (header && nameEl) {
    const row = Array.from(header.children).find((ch) => ch.contains(nameEl));
    if (row) return row;
  }
  return nameEl?.parentElement ?? header ?? card;
}

/** Inject a "+ TritonPlan" button into every package card not already marked. */
function scan(): void {
  let cards: Element[] = [];
  try {
    cards = [...document.querySelectorAll(CARD_SELECTOR)];
  } catch {
    return;
  }
  if (cards.length) injectStyleOnce();
  for (const card of cards) {
    if (card.getAttribute(INJECTED_ATTR)) continue;
    card.setAttribute(INJECTED_ATTR, '1');
    try {
      const btn = makeButton(() => void onAddClick(card, btn));
      injectTarget(card).appendChild(btn);
    } catch {
      /* ignore a single bad node */
    }
  }
}

/** Debounced observer — Fiori re-renders constantly; keep it cheap and idempotent. */
function start(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 400);
  };
  try {
    const obs = new MutationObserver(schedule);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    /* no observer — fall back to a single scan */
  }
  void refreshCourses();
  scan();
}

start();

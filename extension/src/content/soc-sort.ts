/**
 * soc-sort — ISOLATED-world content script on TSS.
 *
 * Optional natural course-code ordering for the Schedule of Classes master list
 * (TSS serves it in ModuleID-ish order and offers no "sort by course"; see
 * lib/soc-sort-core.ts). The toggle lives on ITS OWN strip added above the
 * courses table — never inside TSS's toolbar: crowding that toolbar pushes
 * native buttons into the overflow menu and breaks the table's column layout
 * (the stray draggable column-resizer bar). We only ever ADD elements, we
 * never displace or cover TSS's own. The choice persists in chrome.storage.
 *
 * ⛔ NO-BAN RED LINE: this script only REARRANGES rows the page has already
 * rendered. It never scrolls, never triggers TSS's bottom-of-list lazy load —
 * only the rows the student themselves loaded get sorted. Moving a <tr> keeps
 * its UI5 identity (events resolve by row id, not position), and each course's
 * popin ("Title: …") row moves together with its main row.
 */

import {
  courseKeyFromText,
  isIdentityOrder,
  sortedUnitOrder,
  type CourseKey,
} from '../lib/soc-sort-core.js';

const STORAGE_KEY = 'tp:soc-sort-enabled';
/** The Schedule of Classes master table (MDC table over YUCSD_CON_MODULE). */
const TABLE_SCOPE = 'div[id*="CON_MODULE::LineItem"]';
const TBODY_SELECTOR = `${TABLE_SCOPE} tbody.sapMListItems`;
const BAR_ID = 'tp-soc-sort-bar';
const CHIP_ID = 'tp-soc-sort-chip';
const MAIN_ROW = 'tr.sapMLIB';
const POPIN_ROW = 'tr.sapMListTblSubRow';

let enabled = false;
/** Server-order stamps so turning the toggle off can restore TSS's order. */
const serverIdx = new WeakMap<Element, number>();
const tbodyCounter = new WeakMap<Element, { n: number }>();
/** Set while we shuffle rows so the observer ignores our own mutations. */
let applying = false;

interface Unit {
  rows: Element[];
  key: CourseKey | null;
}

/** Group tbody children into course units (main row + its popin rows) + tail. */
function collectUnits(tbody: Element): { units: Unit[]; tail: Element[] } {
  const units: Unit[] = [];
  const tail: Element[] = [];
  for (const el of [...tbody.children]) {
    if (el.matches(MAIN_ROW) && !el.matches(POPIN_ROW)) {
      units.push({ rows: [el], key: courseKeyFromText(el.textContent ?? '') });
    } else if (el.matches(POPIN_ROW) && units.length > 0) {
      units[units.length - 1]!.rows.push(el);
    } else {
      // growing trigger / anything unrecognized — keep it after the courses
      tail.push(el);
    }
  }
  return { units, tail };
}

/** Stamp not-yet-seen rows with their server order (they render in it). */
function stampServerOrder(tbody: Element, units: Unit[]): void {
  let counter = tbodyCounter.get(tbody);
  if (!counter) {
    counter = { n: 0 };
    tbodyCounter.set(tbody, counter);
  }
  for (const u of units) {
    const main = u.rows[0]!;
    if (!serverIdx.has(main)) serverIdx.set(main, counter.n++);
  }
}

/** Reattach units (and the tail) in the given unit order. */
function applyOrder(tbody: Element, units: Unit[], order: number[], tail: Element[]): void {
  applying = true;
  try {
    const frag = document.createDocumentFragment();
    for (const idx of order) for (const row of units[idx]!.rows) frag.appendChild(row);
    for (const el of tail) frag.appendChild(el);
    tbody.appendChild(frag);
  } finally {
    applying = false;
  }
}

/** Sort every SoC list on the page by course code (idempotent, cheap). */
function sortLists(): void {
  for (const tbody of document.querySelectorAll(TBODY_SELECTOR)) {
    const { units, tail } = collectUnits(tbody);
    stampServerOrder(tbody, units);
    const order = sortedUnitOrder(units.map((u) => u.key));
    if (!order || isIdentityOrder(order)) continue;
    applyOrder(tbody, units, order, tail);
  }
}

/** Put rows back into the server order we stamped (best effort). */
function restoreLists(): void {
  for (const tbody of document.querySelectorAll(TBODY_SELECTOR)) {
    const { units, tail } = collectUnits(tbody);
    const order = units
      .map((u, i) => ({ i, idx: serverIdx.get(u.rows[0]!) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.idx - b.idx || a.i - b.i)
      .map((e) => e.i);
    if (isIdentityOrder(order)) continue;
    applyOrder(tbody, units, order, tail);
  }
}

/* ---- toggle control (own strip: logo — Sort — switch, + confirm popover) --- */
/* Lives on a strip WE add above the courses table (right-aligned) — TSS's own
 * toolbar is never touched, so no native button gets displaced or covered.
 * Branded TritonPlan (logo mark + navy/gold) so it reads as OUR feature.
 * Clicking never toggles right away: a popover explains and asks to confirm.
 * The popover is position:absolute inside the strip, so it moves with the
 * control when the panel scrolls or the layout shifts. */

const POP_ID = 'tp-soc-sort-pop';
const NAVY = '#0b1f3a';
const GOLD = '#f5b800';

/** Tiny trident logo mark (matches the extension icon) as an inline SVG. */
const LOGO_SVG =
  `<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">` +
  `<path d="M12 4v16M5 7v3a7 7 0 0 0 14 0V7" fill="none" stroke="${GOLD}" ` +
  `stroke-width="3" stroke-linecap="round"/></svg>`;

const STYLE_ID = 'tp-soc-sort-style';
function injectStyleOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    /* Cosmetic patch for a TSS display quirk (confirmed present WITHOUT this
     * extension): the table's column-resize handle can get stuck as a thick
     * full-height navy bar. Repaint it Excel-style — an almost invisible grab
     * strip with a hairline that darkens on hover/drag. Resizing still works;
     * only the paint changes. */
    '.sapMPluginsColumnResizerHandle{background:linear-gradient(to right,',
    'transparent calc(50% - 0.5px),#c9d1de calc(50% - 0.5px),',
    '#c9d1de calc(50% + 0.5px),transparent calc(50% + 0.5px)) !important;',
    'cursor:col-resize !important}',
    '.sapMPluginsColumnResizerHandle:hover,.sapMPluginsColumnResizerHandle:active{',
    'background:linear-gradient(to right,transparent calc(50% - 1px),#7e8ba0 calc(50% - 1px),',
    '#7e8ba0 calc(50% + 1px),transparent calc(50% + 1px)) !important}',
    // the strip: a right-aligned row of our own, added above the table
    `#${BAR_ID}{position:relative;display:flex;justify-content:flex-end;`,
    'margin:2px 8px 0 0;padding:0}',
    // pill: logo — Sort — switch
    `#${CHIP_ID}{display:inline-flex;align-items:center;gap:6px;padding:2px 8px 2px 4px;`,
    `font:600 12px/16px "72","72full",Arial,Helvetica,sans-serif;color:${NAVY};`,
    `background:#fff;border:1.5px solid ${NAVY};border-radius:999px;cursor:pointer;`,
    'white-space:nowrap;transition:box-shadow .12s}',
    `#${CHIP_ID}:hover{box-shadow:0 0 0 2px rgba(11,31,58,.15)}`,
    `#${CHIP_ID} .tp-logo{display:inline-flex;align-items:center;justify-content:center;`,
    `width:16px;height:16px;border-radius:50%;background:${NAVY};flex:none}`,
    `#${CHIP_ID} .tp-label{font-weight:700}`,
    // the switch — unmistakable on/off
    `#${CHIP_ID} .tp-switch{position:relative;width:26px;height:14px;border-radius:999px;`,
    'background:#c3ccdb;transition:background .15s;flex:none}',
    `#${CHIP_ID} .tp-switch::after{content:'';position:absolute;top:2px;left:2px;width:10px;height:10px;`,
    'border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}',
    `#${CHIP_ID}[data-on="1"] .tp-switch{background:#2e7d32}`,
    `#${CHIP_ID}[data-on="1"] .tp-switch::after{left:14px}`,
    // confirm popover — anchored to the strip so it follows the control
    `#${POP_ID}{position:absolute;top:calc(100% + 7px);right:0;z-index:2147483000;`,
    'width:300px;max-width:calc(100vw - 24px);padding:13px 15px;',
    'background:#fff;border:1px solid #d5dbe7;border-radius:10px;',
    'box-shadow:0 10px 28px rgba(11,31,58,.22);text-align:left;',
    'font:400 12.5px/1.5 "72","72full",Arial,Helvetica,sans-serif;color:#1c2433}',
    `#${POP_ID} .tp-pop-head{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-weight:800;font-size:13px;color:${NAVY}}`,
    `#${POP_ID} .tp-pop-badge{padding:1px 7px;border-radius:5px;background:${NAVY};color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.03em}`,
    `#${POP_ID} p{margin:0 0 8px}`,
    `#${POP_ID} .tp-pop-note{font-size:11.5px;color:#5a6577}`,
    `#${POP_ID} .tp-pop-beta{padding:1px 6px;border-radius:5px;background:${GOLD};color:${NAVY};font-size:10px;font-weight:800;letter-spacing:.04em}`,
    `#${POP_ID} .tp-pop-row{display:flex;gap:8px;justify-content:flex-end;margin-top:11px}`,
    `#${POP_ID} button{padding:4px 13px;border-radius:7px;font:600 12px/18px inherit;cursor:pointer}`,
    // confirm-enable gets the accent color; confirm-disable stays navy
    `#${POP_ID} .tp-pop-ok{color:#fff;background:${NAVY};border:1px solid ${NAVY}}`,
    `#${POP_ID} .tp-pop-ok:hover{background:#1e2a63}`,
    `#${POP_ID} .tp-pop-ok--accent{color:${NAVY};background:${GOLD};border:1px solid ${GOLD}}`,
    `#${POP_ID} .tp-pop-ok--accent:hover{background:#e0a900;border-color:#e0a900}`,
    `#${POP_ID} .tp-pop-cancel{color:#3d4a5f;background:#fff;border:1px solid #c3ccdb}`,
    `#${POP_ID} .tp-pop-cancel:hover{background:#f2f4f8}`,
  ].join('');
  (document.head || document.documentElement).appendChild(style);
}

function syncChip(chip: HTMLElement): void {
  chip.dataset['on'] = enabled ? '1' : '0';
  chip.setAttribute('aria-checked', enabled ? 'true' : 'false');
  chip.title = enabled
    ? 'TritonPlan course sorting is ON — click to turn it off (restores TSS order).'
    : 'TritonPlan feature: sort the course list by course number. Click for details.';
}

function setEnabled(next: boolean): void {
  enabled = next;
  try {
    void chrome.storage?.local?.set({ [STORAGE_KEY]: enabled });
  } catch {
    /* orphaned context — the visual toggle still works for this page */
  }
  if (enabled) sortLists();
  else restoreLists();
  const chip = document.getElementById(CHIP_ID);
  if (chip) syncChip(chip);
}

function closePopover(): void {
  document.getElementById(POP_ID)?.remove();
  document.removeEventListener('mousedown', onOutsideDown, true);
  document.removeEventListener('keydown', onEscape, true);
}

function onOutsideDown(e: MouseEvent): void {
  const t = e.target as Element | null;
  if (t && (t.closest(`#${POP_ID}`) || t.closest(`#${CHIP_ID}`))) return;
  closePopover();
}

function onEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePopover();
}

/** The confirm menu: says what the switch is, whose it is, and asks to confirm. */
function openPopover(): void {
  if (document.getElementById(POP_ID)) {
    closePopover();
    return;
  }
  const bar = document.getElementById(BAR_ID);
  if (!bar) return;
  const pop = document.createElement('div');
  pop.id = POP_ID;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'TritonPlan course sorting');

  const head = document.createElement('div');
  head.className = 'tp-pop-head';
  const badge = document.createElement('span');
  badge.className = 'tp-pop-badge';
  badge.textContent = 'TritonPlan';
  const beta = document.createElement('span');
  beta.className = 'tp-pop-beta';
  beta.textContent = 'BETA';
  head.append(badge, document.createTextNode('Sort courses A–Z'), beta);

  const what = document.createElement('p');
  what.textContent =
    'A TritonPlan beta feature — this switch is not part of TSS. It works by ' +
    'rearranging rows already shown in your browser (pure DOM reordering); ' +
    'nothing is ever sent to any server.';

  const effect = document.createElement('p');
  effect.textContent =
    'On: the loaded course list reorders by course number (040A → 040B → 041A → 130 …), ' +
    'and courses you load later are sorted in automatically. ' +
    'Off: the list goes back to exactly how TSS had it.';

  const note = document.createElement('p');
  note.className = 'tp-pop-note';
  note.textContent =
    'Only courses already loaded are sorted — scroll to the bottom of the list and ' +
    'TSS loads more on its own.';

  const row = document.createElement('div');
  row.className = 'tp-pop-row';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'tp-pop-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closePopover);
  const ok = document.createElement('button');
  ok.type = 'button';
  // the confirm-enable action carries the brand accent
  ok.className = 'tp-pop-ok tp-pop-ok--accent';
  ok.textContent = 'Turn sorting on';
  ok.addEventListener('click', () => {
    setEnabled(true);
    closePopover();
  });
  row.append(cancel, ok);

  pop.append(head, what, effect, note, row);
  // anchored inside the strip (absolute) — follows the control on scroll/layout
  bar.appendChild(pop);

  document.addEventListener('mousedown', onOutsideDown, true);
  document.addEventListener('keydown', onEscape, true);
}

/** Keep our own strip (logo — Sort — switch) right above the SoC table.
 *  We ADD a sibling row; TSS's toolbar and buttons are never touched. */
function injectChip(): void {
  if (document.getElementById(BAR_ID)) return;
  const table = document.querySelector(TABLE_SCOPE);
  if (!table || !table.parentElement) {
    // list (and our anchor) got re-rendered away — don't leave an orphaned menu
    if (document.getElementById(POP_ID)) closePopover();
    return;
  }
  injectStyleOnce();

  const bar = document.createElement('div');
  bar.id = BAR_ID;

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = CHIP_ID;
  chip.setAttribute('role', 'switch');
  chip.setAttribute('aria-label', 'TritonPlan: sort courses by course number');
  const logo = document.createElement('span');
  logo.className = 'tp-logo';
  logo.innerHTML = LOGO_SVG;
  const label = document.createElement('span');
  label.className = 'tp-label';
  label.textContent = 'Sort';
  const sw = document.createElement('span');
  sw.className = 'tp-switch';
  sw.setAttribute('aria-hidden', 'true');
  chip.append(logo, label, sw);
  syncChip(chip);
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Turning ON asks for confirmation (the popover explains the beta feature);
    // turning OFF is instant — no menu in the way of undoing.
    if (enabled) setEnabled(false);
    else openPopover();
  });

  bar.appendChild(chip);
  table.parentElement.insertBefore(bar, table);
}

/* ---- boot ----------------------------------------------------------------- */

function start(): void {
  try {
    void chrome.storage?.local?.get(STORAGE_KEY).then((data) => {
      enabled = data?.[STORAGE_KEY] === true;
      const chip = document.getElementById(CHIP_ID) as HTMLButtonElement | null;
      if (chip) syncChip(chip);
      if (enabled) sortLists();
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !(STORAGE_KEY in changes)) return;
      enabled = changes[STORAGE_KEY]?.newValue === true;
      const chip = document.getElementById(CHIP_ID) as HTMLButtonElement | null;
      if (chip) syncChip(chip);
      if (enabled) sortLists();
      else restoreLists();
    });
  } catch {
    /* storage unavailable (orphaned) — default off */
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (applying || timer) return;
    timer = setTimeout(() => {
      timer = null;
      injectChip();
      if (enabled) sortLists();
    }, 150);
  };
  try {
    const obs = new MutationObserver(schedule);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    /* no observer — single pass below */
  }
  // The column-resizer repaint should apply even before (or without) the strip.
  injectStyleOnce();
  injectChip();
}

start();

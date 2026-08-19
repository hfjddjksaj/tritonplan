/**
 * Popup script: lists the courses the student has passively browsed (captured via TSS
 * OData the page already fetched) and offers an "Open TritonPlan" button.
 *
 * ⛔ NO-BAN RED LINE: reads only already-captured data from the SW; opens only OUR
 * planner. No TSS traffic.
 */

import { MSG } from '../config.js';
import type { BookedModule, CourseOffering } from '@triton/shared';

/** "just now" / "6m ago" / "3h ago" / "2d ago" — enough to judge staleness. */
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * TSS names your enrolments in exactly one place — the Booked Courses card on its
 * home page — and fetches that list only when the home page loads in full. Say
 * plainly whether it has ever reached us, so "nothing is marked as booked" stops
 * being a mystery the student can't see into.
 */
function renderBooked(list: BookedModule[] | null, at: string | null): void {
  const el = document.getElementById('booked');
  if (!el) return;
  el.textContent = '';
  if (list === null) {
    el.className = 'booked none';
    el.textContent =
      'Not read yet. Open tss.ucsd.edu — the home page is where TSS lists what you’re enrolled in, and loading it is what hands the list over.';
    return;
  }
  el.className = 'booked';
  const when = document.createElement('span');
  when.className = 'when';
  if (list.length === 0) {
    el.textContent = 'TSS reported no bookings ';
    when.textContent = at ? `(read ${ago(at)})` : '';
    el.appendChild(when);
    return;
  }
  const codes = document.createElement('span');
  codes.className = 'codes';
  codes.textContent = list.map((b) => b.courseCode).join(', ');
  when.textContent = at ? ` · read ${ago(at)}` : '';
  el.appendChild(codes);
  el.appendChild(when);
}

function render(courses: CourseOffering[]): void {
  const list = document.getElementById('courses');
  if (!list) return;
  list.textContent = '';
  if (!courses.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing captured yet — browse a course in TSS.';
    list.appendChild(li);
    return;
  }
  for (const c of courses) {
    const li = document.createElement('li');
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = c.courseCode;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = c.title && c.title !== c.courseCode ? ` — ${c.title}` : '';
    li.appendChild(code);
    li.appendChild(title);
    list.appendChild(li);
  }
}

async function load(): Promise<void> {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.GET_COURSES });
    render(Array.isArray(res) ? (res as CourseOffering[]) : []);
  } catch {
    render([]);
  }
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG.GET_BOOKED_STATUS })) as {
      list?: BookedModule[] | null;
      at?: string | null;
    } | null;
    renderBooked(Array.isArray(res?.list) ? res.list : null, res?.at ?? null);
  } catch {
    renderBooked(null, null);
  }
}

document.getElementById('open')?.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: MSG.OPEN_PLANNER });
  window.close();
});

void load();

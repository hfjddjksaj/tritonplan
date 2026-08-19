/**
 * Popup script: lists the courses the student has passively browsed (captured via TSS
 * OData the page already fetched) and offers an "Open TritonPlan" button.
 *
 * ⛔ NO-BAN RED LINE: reads only already-captured data from the SW; opens only OUR
 * planner. No TSS traffic.
 */

import { MSG } from '../config.js';
import type { CourseOffering } from '@triton/shared';

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
}

document.getElementById('open')?.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: MSG.OPEN_PLANNER });
  window.close();
});

void load();

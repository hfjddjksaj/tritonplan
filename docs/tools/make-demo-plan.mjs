/**
 * Build a realistic "freshman engineering" demo PlanState for marketing screenshots.
 * - CSE 8A: real captured Fall 2026 data (all 9 section options kept for the
 *   "switch section to fix a conflict" GIF). Selected option = Wed 11:00 lab.
 * - HUM 1 lecture MWF 11:00–11:50 → deliberate Wed 11:00 red conflict vs CSE 8A lab.
 * - MATH 20A final = same 12/09 11:30 slot as CSE 8A → deliberate finals conflict.
 * Prints share URLs (localhost + prod) and writes demo-plan.json next to itself.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const LZString = require('lz-string'); // resolved from the repo root node_modules

const here = dirname(fileURLToPath(import.meta.url));
const TERM = { year: '2026', period: '2', label: 'Fall 2026' };

// --- CSE 8A straight from the real captured sample data -------------------
const samples = JSON.parse(
  readFileSync(join(here, '../../web/src/data/sample-courses.json'), 'utf8'),
);
const cse8a = samples.find((c) => c.courseCode === 'CSE-008A');
if (!cse8a) throw new Error('CSE-008A not found in sample-courses.json');

// --- helpers for the hand-built courses -----------------------------------
let eventSeq = 5000;
function comp({ type, typeText, section, days, start, end, building, room, rawDays, ampm, finalLine }) {
  const location = `${building} Room ${room}`;
  let rawSched = `${rawDays} ${ampm} In Person @ ${location}`;
  if (finalLine) rawSched += `\n${finalLine}`;
  return {
    id: `E 0000${eventSeq++}`,
    type, typeText,
    sectionCode: section,
    instructors: ['Staff'],
    meetings: [{ days, start, end, modality: 'In Person', building, room, location }],
    unscheduled: false,
    beginDate: '2026-09-24',
    endDate: '2026-12-04',
    rawSched,
  };
}

let pkgSeq = 154400;
function course({ subject, number, title, units, moduleId, components, final }) {
  const courseCode = `${subject}-${number}`;
  const id = `SE00${pkgSeq++}`;
  return {
    id: `${courseCode}|2026|2`,
    moduleId, subject, number, courseCode, title,
    term: TERM, units,
    options: [{
      id, code: 'P-001-001', enrollCode: id,
      limit: 120, seatsAvailable: 47, waitlist: 0,
      components, final,
    }],
  };
}

const math20a = course({
  subject: 'MATH', number: '20A', title: 'Calculus for Science and Engineering',
  units: 4, moduleId: '8721',
  components: [
    comp({ type: 'LE', typeText: 'Lecture', section: '001-000-LE',
      days: ['Mon', 'Wed', 'Fri'], start: '10:00', end: '10:50',
      building: 'Peterson Hall', room: '108',
      rawDays: 'M, W, F', ampm: '10:00 AM - 10:50 AM',
      finalLine: 'Final Examination 12/09/2026 11:30 AM - 02:29 PM In Person' }),
    comp({ type: 'DI', typeText: 'Discussion', section: '001-001-DI',
      days: ['Tue'], start: '08:00', end: '08:50',
      building: 'Warren Lecture Hall', room: '2005',
      rawDays: 'Tu', ampm: '08:00 AM - 08:50 AM' }),
  ],
  // Same 12/09 slot as CSE 8A — the deliberate finals conflict.
  final: { date: '2026-12-09', start: '11:30', end: '14:29', modality: 'In Person' },
});

const chem6a = course({
  subject: 'CHEM', number: '6A', title: 'General Chemistry I',
  units: 4, moduleId: '8830',
  components: [
    comp({ type: 'LE', typeText: 'Lecture', section: '001-000-LE',
      days: ['Tue', 'Thu'], start: '12:30', end: '13:50',
      building: 'York Hall', room: '2622',
      rawDays: 'Tu, Th', ampm: '12:30 PM - 01:50 PM',
      finalLine: 'Final Examination 12/12/2026 08:00 AM - 10:59 AM In Person' }),
    comp({ type: 'DI', typeText: 'Discussion', section: '001-001-DI',
      days: ['Mon'], start: '17:00', end: '17:50',
      building: 'York Hall', room: '2722',
      rawDays: 'M', ampm: '05:00 PM - 05:50 PM' }),
  ],
  final: { date: '2026-12-12', start: '08:00', end: '10:59', modality: 'In Person' },
});

const hum1 = course({
  subject: 'HUM', number: '1', title: 'Foundations of Western Civilization',
  units: 6, moduleId: '8912',
  components: [
    // MWF 11:00 — Wednesday overlaps the selected CSE 8A lab (Wed 11:00–11:50).
    comp({ type: 'LE', typeText: 'Lecture', section: '001-000-LE',
      days: ['Mon', 'Wed', 'Fri'], start: '11:00', end: '11:50',
      building: 'Pepper Canyon Hall', room: '106',
      rawDays: 'M, W, F', ampm: '11:00 AM - 11:50 AM',
      finalLine: 'Final Examination 12/11/2026 11:30 AM - 02:29 PM In Person' }),
    comp({ type: 'DI', typeText: 'Discussion', section: '001-001-DI',
      days: ['Fri'], start: '13:00', end: '13:50',
      building: 'Pepper Canyon Hall', room: '121',
      rawDays: 'F', ampm: '01:00 PM - 01:50 PM' }),
  ],
  final: { date: '2026-12-11', start: '11:30', end: '14:29', modality: 'In Person' },
});

const phys2a = course({
  subject: 'PHYS', number: '2A', title: 'Physics - Mechanics',
  units: 4, moduleId: '9034',
  components: [
    comp({ type: 'LE', typeText: 'Lecture', section: '001-000-LE',
      days: ['Mon', 'Wed', 'Fri'], start: '09:00', end: '09:50',
      building: 'Center Hall', room: '113',
      rawDays: 'M, W, F', ampm: '09:00 AM - 09:50 AM',
      finalLine: 'Final Examination 12/08/2026 03:00 PM - 05:59 PM In Person' }),
    comp({ type: 'DI', typeText: 'Discussion', section: '001-001-DI',
      days: ['Thu'], start: '16:00', end: '16:50',
      building: 'Center Hall', room: '214',
      rawDays: 'Th', ampm: '04:00 PM - 04:50 PM' }),
  ],
  final: { date: '2026-12-08', start: '15:00', end: '17:59', modality: 'In Person' },
});

// --- assemble the plan -----------------------------------------------------
const plan = {
  version: 1,
  term: TERM,
  entries: [
    // SE00154304 = P-001-003, Wed 11:00–11:50 lab → red pair with HUM 1 on Wed.
    { course: cse8a,  selectedOptionId: 'SE00154304',              color: '231' },
    { course: math20a, selectedOptionId: math20a.options[0].id,    color: '38'  },
    { course: chem6a, selectedOptionId: chem6a.options[0].id,      color: '187' },
    { course: hum1,   selectedOptionId: hum1.options[0].id,        color: '340' },
    { course: phys2a, selectedOptionId: phys2a.options[0].id,      color: '265' },
  ],
};

const token = LZString.compressToEncodedURIComponent(JSON.stringify(plan));
writeFileSync(join(here, 'demo-plan.json'), JSON.stringify(plan, null, 2));
writeFileSync(join(here, 'demo-plan-urls.txt'),
  [
    `local: http://localhost:5173/#p=${token}`,
    `prod:  https://hfjddjksaj.github.io/tritonplan/#p=${token}`,
  ].join('\n') + '\n');

console.log(`plan JSON bytes: ${JSON.stringify(plan).length}`);
console.log(`token length: ${token.length}`);
console.log('URLs written to demo-plan-urls.txt');

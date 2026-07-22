import type { WeeklyConflict, FinalConflict } from '@triton/shared';
import { Warning } from './icons';

interface Props {
  weekly: WeeklyConflict[];
  finals: FinalConflict[];
  codeById: Map<string, string>;
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function ConflictBanner({ weekly, finals, codeById }: Props) {
  if (weekly.length === 0 && finals.length === 0) return null;

  // Aggregate weekly clashes per course-pair, collecting the days they overlap.
  const weeklyByPair = new Map<string, { a: string; b: string; days: Set<string> }>();
  for (const c of weekly) {
    const k = pairKey(c.aCourseId, c.bCourseId);
    const entry = weeklyByPair.get(k) ?? { a: c.aCourseId, b: c.bCourseId, days: new Set() };
    entry.days.add(c.day);
    weeklyByPair.set(k, entry);
  }
  const finalPairs = new Map<string, FinalConflict>();
  for (const c of finals) finalPairs.set(pairKey(c.aCourseId, c.bCourseId), c);

  const code = (id: string) => codeById.get(id) ?? id;
  const total = weeklyByPair.size + finalPairs.size;

  return (
    <div className="banner" role="alert">
      <span className="banner__icon" aria-hidden>
        <Warning size={18} />
      </span>
      <div>
        <div className="banner__title">
          {total} scheduling {total === 1 ? 'conflict' : 'conflicts'} — resolve before you enroll
        </div>
        <ul className="banner__list">
          {[...weeklyByPair.values()].map((c) => (
            <li key={`w-${c.a}-${c.b}`} className="banner__clash">
              <span className="mono">{code(c.a)}</span> × <span className="mono">{code(c.b)}</span>{' '}
              overlap {[...c.days].join(', ')}
            </li>
          ))}
          {[...finalPairs.values()].map((c) => (
            <li key={`f-${c.aCourseId}-${c.bCourseId}`} className="banner__clash">
              <span className="mono">{code(c.aCourseId)}</span> ×{' '}
              <span className="mono">{code(c.bCourseId)}</span> share a final on{' '}
              <span className="mono">{c.date}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

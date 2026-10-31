import type { RmpLookup } from '@triton/shared';
import { tx, type Db } from '../db/db';
import type { RmpTeacher } from './fetch';

/** Same folding for stored names and lookups, so they can only differ by real spelling. */
export function nameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Clear, insert and stamp in one transaction: readers see the old snapshot or the new one, never a mix. */
export function replaceTeachers(db: Db, rows: RmpTeacher[], nowIso: string): void {
  tx(db, () => {
    db.exec('DELETE FROM rmp_teachers');
    const ins = db.prepare('INSERT OR REPLACE INTO rmp_teachers (legacy_id, first_name, last_name, department, avg_rating, num_ratings, name_key) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const t of rows) {
      ins.run(t.legacyId, t.firstName.trim(), t.lastName.trim(), t.department, t.avgRating, t.numRatings, nameKey(`${t.firstName} ${t.lastName}`));
    }
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('rmp_fetched_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(nowIso);
  });
}

export function rmpFetchedAt(db: Db): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'rmp_fetched_at'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

interface Row {
  legacy_id: number;
  first_name: string;
  last_name: string;
  department: string | null;
  avg_rating: number | null;
  num_ratings: number;
}

/** A wrong professor is worse than none: only a unique exact full-name match counts. */
export function lookupTeachers(db: Db, names: string[]): RmpLookup[] {
  const q = db.prepare('SELECT legacy_id, first_name, last_name, department, avg_rating, num_ratings FROM rmp_teachers WHERE name_key = ? LIMIT 2');
  return names.map((name) => {
    const rows = q.all(nameKey(name)) as unknown as Row[];
    const searchUrl = `https://www.ratemyprofessors.com/search/professors/1079?q=${encodeURIComponent(name)}`;
    if (rows.length !== 1) return { name, match: null, searchUrl };
    const r = rows[0]!;
    return {
      name,
      match: {
        legacyId: r.legacy_id,
        firstName: r.first_name,
        lastName: r.last_name,
        department: r.department,
        avgRating: r.num_ratings === 0 ? null : r.avg_rating,
        numRatings: r.num_ratings,
        url: `https://www.ratemyprofessors.com/professor/${r.legacy_id}`,
      },
      searchUrl,
    };
  });
}

import { z } from 'zod';
import type { Deps } from '../app';

/** What status.ucsd.edu (Atlassian Statuspage) says about TSS. Read-only, public, and never TSS itself. */

const INCIDENTS_URL = 'https://status.ucsd.edu/api/v2/incidents.json';
const TSS = /\bTSS\b|Triton Student/i;
const DISCORD_MAX = 1900; // Discord refuses content over 2000 characters

const officialList = z.object({
  incidents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      shortlink: z.string().optional(),
      updated_at: z.string().nullish(),
      incident_updates: z.array(z.object({ id: z.string(), body: z.string() })),
    }),
  ),
});
export type Incident = z.infer<typeof officialList>['incidents'][number];

export const isTss = (incident: Incident): boolean => TSS.test(incident.name);

/** The TSS incident that changed most recently, open or resolved; null when the page lists none. */
export function latestTss(incidents: Incident[]): Incident | null {
  const at = (i: Incident): number => (i.updated_at ? Date.parse(i.updated_at) || 0 : 0);
  // The sort is stable, so incidents without a time keep the page's own order (newest change first).
  return incidents.filter((i) => isTss(i) && i.incident_updates.length > 0).sort((a, b) => at(b) - at(a))[0] ?? null;
}

export function formatIncident(incident: Incident): string {
  const lines = [`**${incident.name}** — ${incident.status}`];
  // Update bodies are HTML on the status page; Discord would show the tags as text.
  const body = (incident.incident_updates[0]?.body ?? '').replace(/<[^>]+>/g, '').trim();
  if (body) lines.push(body);
  if (incident.shortlink) lines.push(incident.shortlink);
  return lines.join('\n').slice(0, DISCORD_MAX);
}

export interface StatusPage {
  /** Every incident the page lists, or null when this reader's per-minute budget is spent. Throws on a bad answer. */
  incidents(): Promise<Incident[] | null>;
}

/** Each caller gets its own budget, so a burst on one path cannot starve the other. */
export function createStatusPage(deps: Pick<Deps, 'fetch' | 'now'>, perMinute = 6): StatusPage {
  let looks: number[] = [];
  return {
    async incidents() {
      const now = deps.now().getTime();
      looks = looks.filter((t) => now - t < 60_000);
      if (looks.length >= perMinute) return null;
      looks.push(now);
      const res = await deps.fetch(INCIDENTS_URL, {
        headers: { 'User-Agent': 'TritonPlan/2.0 (+https://tritonplan.cn)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`status page responded ${res.status}`);
      }
      // V8's own JSON error quotes the start of the body, which must not reach a log line.
      const raw: unknown = await res.json().catch(() => {
        throw new Error('status page response was not JSON');
      });
      const parsed = officialList.safeParse(raw);
      if (!parsed.success) throw new Error('status page response had an unexpected shape');
      return parsed.data.incidents;
    },
  };
}

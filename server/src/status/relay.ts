import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Deps } from '../app';

/**
 * UCSD status page -> Discord. status.ucsd.edu (Atlassian Statuspage) calls our hook when an incident changes;
 * updates to TSS incidents are passed on to one Discord channel.
 *
 * The hook is public and anyone can POST to it, so the delivery is only a nudge: it names an incident, and what
 * gets posted is read from the status page's own API. A forged delivery can at most make us post a real update
 * a little early. This never contacts TSS, and no account data is involved.
 */

const INCIDENTS_URL = 'https://status.ucsd.edu/api/v2/incidents.json';
const TSS = /\bTSS\b|Triton Student/i;
const DISCORD_MAX = 1900; // Discord refuses content over 2000 characters
const LOOKUPS_PER_MINUTE = 6;
const LAG_RETRY_MS = 3000;

const delivery = z.object({
  incident: z.object({
    id: z.string().regex(/^[a-z0-9]{6,24}$/),
    incident_updates: z.array(z.object({ id: z.string() })).optional(),
  }),
});

const officialList = z.object({
  incidents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      shortlink: z.string().optional(),
      incident_updates: z.array(z.object({ id: z.string(), body: z.string() })),
    }),
  ),
});
type Incident = z.infer<typeof officialList>['incidents'][number];

export interface StatusRelay {
  /** Never rejects: a failure is one log line. */
  handle(payload: unknown): Promise<void>;
}

export function formatIncident(incident: Incident): string {
  const lines = [`**${incident.name}** — ${incident.status}`];
  // Update bodies are HTML on the status page; Discord would show the tags as text.
  const body = (incident.incident_updates[0]?.body ?? '').replace(/<[^>]+>/g, '').trim();
  if (body) lines.push(body);
  if (incident.shortlink) lines.push(incident.shortlink);
  return lines.join('\n').slice(0, DISCORD_MAX);
}

export function createStatusRelay(
  deps: Pick<Deps, 'fetch' | 'now'>,
  webhookUrl: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): StatusRelay {
  // Update ids already sent. In memory only: after a restart a repeated delivery can post one update twice.
  // It grows by one per real TSS update, so it needs no sweep.
  const posted = new Set<string>();
  let lookups: number[] = [];

  /** The incident as the status page itself reports it; null when it is not listed or the budget is spent. */
  const lookup = async (id: string): Promise<Incident | null> => {
    const now = deps.now().getTime();
    lookups = lookups.filter((t) => now - t < 60_000);
    if (lookups.length >= LOOKUPS_PER_MINUTE) return null;
    lookups.push(now);
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
    return parsed.data.incidents.find((i) => i.id === id) ?? null;
  };

  const run = async (payload: unknown): Promise<void> => {
    const hook = delivery.safeParse(payload);
    if (!hook.success) return; // component changes and anything else carry no incident
    const { id, incident_updates: claimed } = hook.data.incident;

    let incident = await lookup(id);
    if (!incident || !TSS.test(incident.name)) return;
    // The delivery can beat the API: it names an update the list does not show yet. Look once more.
    const newest = incident.incident_updates[0]?.id;
    if (newest && posted.has(newest) && claimed?.[0] && claimed[0].id !== newest) {
      await wait(LAG_RETRY_MS);
      incident = await lookup(id);
    }
    const update = incident?.incident_updates[0];
    if (!incident || !update || posted.has(update.id)) return;

    posted.add(update.id); // before the send, so two deliveries of one update cannot both post it
    try {
      const res = await deps.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No mentions, whatever the text says.
        body: JSON.stringify({ content: formatIncident(incident), allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel().catch(() => {});
      if (!res.ok) throw new Error(`Discord responded ${res.status}`);
    } catch (e) {
      posted.delete(update.id); // the next delivery may try again
      throw e;
    }
    console.log(`Status relay: posted a TSS update (${incident.status})`);
  };

  return {
    async handle(payload) {
      try {
        await run(payload);
      } catch (e) {
        // Message only: no body, no stack, and never the webhook address.
        console.error(`Status relay failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    },
  };
}

/** Mounted at /api/hooks, ahead of the same-origin guard: the status page is not a browser on our origin. */
export function statusHookRoutes(relay: StatusRelay | null): Hono {
  const r = new Hono();

  // Lets the operator see whether the webhook address in the env file was accepted, without reading the journal.
  r.get('/ucsd-status', (c) => c.json({ relay: relay ? 'on' : 'off' }));

  r.post(
    '/ucsd-status',
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      const payload: unknown = await c.req.json().catch(() => null);
      // Answered at once: the status page counts a slow or non-2xx reply as a failed delivery and drops the
      // subscription after about ten of them.
      if (relay && payload) void relay.handle(payload);
      return c.json({ ok: true });
    },
  );

  return r;
}

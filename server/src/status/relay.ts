import { z } from 'zod';
import type { Deps } from '../app';
import type { DiscordTarget } from '../config';
import { createStatusPage, formatIncident, isTss, type Incident } from './page';

/**
 * UCSD status page -> Discord. status.ucsd.edu (Atlassian Statuspage) calls our hook when an incident changes;
 * updates to TSS incidents are posted in one Discord channel by our bot.
 *
 * The hook is public and anyone can POST to it, so the delivery is only a nudge: it names an incident, and what
 * gets posted is read from the status page's own API. A forged delivery can at most make us post a real update
 * a little early. This never contacts TSS, and no account data is involved.
 */

const LAG_RETRY_MS = 3000;

const delivery = z.object({
  incident: z.object({
    id: z.string().regex(/^[a-z0-9]{6,24}$/),
    incident_updates: z.array(z.object({ id: z.string() })).optional(),
  }),
});

export interface StatusRelay {
  /** Never rejects: a failure is one log line. */
  handle(payload: unknown): Promise<void>;
}

export function createStatusRelay(
  deps: Pick<Deps, 'fetch' | 'now'>,
  target: DiscordTarget,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): StatusRelay {
  const page = createStatusPage(deps);
  // Update ids already sent. In memory only: after a restart a repeated delivery can post one update twice.
  // It grows by one per real TSS update, so it needs no sweep.
  const posted = new Set<string>();

  /** The incident as the status page itself reports it; null when it is not listed or the budget is spent. */
  const lookup = async (id: string): Promise<Incident | null> =>
    (await page.incidents())?.find((i) => i.id === id) ?? null;

  const run = async (payload: unknown): Promise<void> => {
    const hook = delivery.safeParse(payload);
    if (!hook.success) return; // component changes and anything else carry no incident
    const { id, incident_updates: claimed } = hook.data.incident;

    let incident = await lookup(id);
    if (!incident || !isTss(incident)) return;
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
      // Plain REST: posting a message needs no gateway connection, so there is no bot process to keep alive.
      const res = await deps.fetch(`https://discord.com/api/v10/channels/${target.channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${target.botToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://tritonplan.cn, 2.0)', // the form Discord asks bots to use
        },
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
        // Message only: no body, no stack, and never the bot token.
        console.error(`Status relay failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    },
  };
}

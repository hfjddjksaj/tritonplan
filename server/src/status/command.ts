import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../app';
import type { DiscordTarget } from '../config';
import { createStatusPage, formatIncident, latestTss } from './page';

/**
 * The bot's /status command, over HTTP: Discord POSTs each use of the command to our interactions endpoint, and
 * the answer is the newest TSS update on the UCSD status page. No gateway connection, so no bot process.
 *
 * Discord signs every request (Ed25519, over timestamp + body) with the application's key; anything unsigned
 * or wrongly signed is refused, which is also what Discord checks before it accepts the endpoint address.
 * Nothing from a request is stored or logged.
 */

const API = 'https://discord.com/api/v10';
const BOT_AGENT = 'DiscordBot (https://tritonplan.cn, 2.0)'; // the form Discord asks bots to use
const MAX_SKEW_MS = 5 * 60_000;
const COMMAND = { name: 'status', description: 'Latest TSS update from the UCSD status page', type: 1 };

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const EPHEMERAL = 64;

const application = z.object({ id: z.string().regex(/^\d{17,20}$/), verify_key: z.string().regex(/^[0-9a-f]{64}$/i) });
const interaction = z.object({
  type: z.number(),
  token: z.string().max(500).optional(),
  data: z.object({ name: z.string() }).optional(),
});

interface App {
  id: string;
  key: KeyObject;
}

/** Who the token belongs to: the application id, and the key its interactions are signed with. Throws without the token in the message. */
async function fetchApp(deps: Pick<Deps, 'fetch'>, target: DiscordTarget): Promise<App> {
  const res = await deps.fetch(`${API}/applications/@me`, {
    headers: { Authorization: `Bot ${target.botToken}`, 'User-Agent': BOT_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Discord responded ${res.status}`);
  }
  const parsed = application.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error('Discord described the application in an unexpected shape');
  // Node takes an Ed25519 public key as SPKI: this fixed header, then the 32 raw bytes Discord publishes.
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(parsed.data.verify_key, 'hex')]);
  return { id: parsed.data.id, key: createPublicKey({ key: spki, format: 'der', type: 'spki' }) };
}

function signedByDiscord(key: KeyObject, signature: string | undefined, timestamp: string | undefined, body: string, now: Date): boolean {
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature) || !/^\d{1,12}$/.test(timestamp)) return false;
  // A captured request cannot be replayed later.
  if (Math.abs(now.getTime() - Number(timestamp) * 1000) > MAX_SKEW_MS) return false;
  try {
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export interface StatusCommand {
  /** The HTTP answer to one request on the interactions endpoint. Never rejects. */
  handle(signature: string | undefined, timestamp: string | undefined, rawBody: string): Promise<{ status: 200 | 401; body: unknown }>;
}

export function createStatusCommand(deps: Pick<Deps, 'fetch' | 'now'>, target: DiscordTarget): StatusCommand {
  const page = createStatusPage(deps);
  let app: App | null = null;
  let lastTry = -Infinity;

  /** Asked once and kept; after a failure, asked again at most once a minute. */
  const knownApp = async (): Promise<App | null> => {
    if (app) return app;
    const now = deps.now().getTime();
    if (now - lastTry < 60_000) return null;
    lastTry = now;
    try {
      app = await fetchApp(deps, target);
    } catch (e) {
      console.error(`Status command is off: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    return app;
  };

  /** Fills in the "thinking…" placeholder that the deferred answer put in the channel. */
  const answer = async (appId: string, token: string): Promise<void> => {
    let content: string;
    try {
      const incidents = await page.incidents();
      const newest = incidents && latestTss(incidents);
      if (incidents === null) content = 'Too many checks right now. Try again in a minute.';
      else content = newest ? formatIncident(newest) : 'status.ucsd.edu lists no TSS incident right now.';
    } catch (e) {
      console.error(`Status command failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      content = 'Could not read status.ucsd.edu just now. Try again in a minute.';
    }
    try {
      const res = await deps.fetch(`${API}/webhooks/${appId}/${encodeURIComponent(token)}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'User-Agent': BOT_AGENT },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel().catch(() => {});
      if (!res.ok) throw new Error(`Discord responded ${res.status}`);
    } catch (e) {
      // Message only: the address holds the interaction's token.
      console.error(`Status command failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  return {
    async handle(signature, timestamp, rawBody) {
      const known = await knownApp();
      if (!known || !signedByDiscord(known.key, signature, timestamp, rawBody, deps.now())) {
        return { status: 401, body: { error: 'unauthorized' } };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(rawBody);
      } catch {
        // falls through to the "unknown" answer
      }
      const parsed = interaction.safeParse(json);
      if (parsed.success && parsed.data.type === PING) return { status: 200, body: { type: PONG } };
      if (parsed.success && parsed.data.type === APPLICATION_COMMAND && parsed.data.data?.name === COMMAND.name && parsed.data.token) {
        // Discord wants an answer within three seconds, and the status page may take longer: say "working on
        // it" now and fill the message in afterwards.
        void answer(known.id, parsed.data.token);
        return { status: 200, body: { type: DEFERRED_MESSAGE } };
      }
      return { status: 200, body: { type: MESSAGE, data: { content: 'Unknown command.', flags: EPHEMERAL } } };
    },
  };
}

/** Tells Discord the command exists (creating one that already exists just replaces it). Never rejects. */
export async function registerStatusCommand(deps: Pick<Deps, 'fetch'>, target: DiscordTarget): Promise<void> {
  try {
    const app = await fetchApp(deps, target);
    const res = await deps.fetch(`${API}/applications/${app.id}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bot ${target.botToken}`, 'Content-Type': 'application/json', 'User-Agent': BOT_AGENT },
      body: JSON.stringify(COMMAND),
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    if (!res.ok) throw new Error(`Discord responded ${res.status}`);
    console.log('Status command: /status registered');
  } catch (e) {
    console.error(`Status command registration failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}

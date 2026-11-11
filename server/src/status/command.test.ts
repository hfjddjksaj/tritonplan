import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { testDeps } from '../test-helpers';
import { createStatusCommand, registerStatusCommand } from './command';

const TARGET = { botToken: 'secret-token', channelId: '1456539102395760764' };
const APP_ID = '1437000000000000001';
const LIST = 'https://status.ucsd.edu/api/v2/incidents.json';
const NOW = Date.parse('2026-11-10T23:00:00.000Z');

// Discord's side of the handshake: it signs with the private half, we are told the public half.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const verifyKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

function signed(body: string, at = NOW) {
  const timestamp = String(Math.floor(at / 1000));
  return { timestamp, signature: sign(null, Buffer.from(timestamp + body), privateKey).toString('hex'), body };
}

interface Incident { id: string; name: string; status: string; shortlink?: string; updated_at?: string; incident_updates: { id: string; body: string }[] }
const known: Incident = { id: 'cq6ndhhkddd4', name: 'Triton Student System (TSS) Known Issues', status: 'monitoring', updated_at: '2026-09-22T14:25:21.000-07:00', incident_updates: [{ id: 'k1', body: 'See the known issues list.' }] };
const down: Incident = { id: 'hm72y9krwjqx', name: 'TSS Down', status: 'resolved', shortlink: 'https://stspg.io/9jh550cp9275', updated_at: '2026-11-10T16:05:00.000-08:00', incident_updates: [{ id: 'u2', body: 'This incident has been resolved.' }, { id: 'u1', body: 'Investigating.' }] };
const other: Incident = { id: 'p492l570j1ys', name: 'uAchieve Down', status: 'investigating', updated_at: '2026-11-10T16:30:00.000-08:00', incident_updates: [{ id: 'x1', body: 'Audits cannot be run.' }] };

/** Discord and the status page in one fetch. `appStatus` / `listStatus` other than 200 make that side fail. */
function fakeNet(incidents: Incident[], opts: { appStatus?: number; listStatus?: number } = {}) {
  const calls: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const net = {
    calls,
    opts,
    of: (part: string) => calls.filter((c) => c.url.includes(part)),
    fetchFn: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/applications/@me')) {
        return new Response(JSON.stringify({ id: APP_ID, verify_key: verifyKey }), { status: net.opts.appStatus ?? 200 });
      }
      if (url === LIST) return new Response(JSON.stringify({ incidents }), { status: net.opts.listStatus ?? 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  };
  return net;
}

const useStatus = JSON.stringify({ type: 2, token: 'interaction-token', data: { name: 'status' }, member: { user: { id: '42' } } });
const FOLLOW_UP = `https://discord.com/api/v10/webhooks/${APP_ID}/interaction-token/messages/@original`;

let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  err.mockRestore();
});

const command = (net: ReturnType<typeof fakeNet>, now = () => new Date(NOW)) => createStatusCommand({ fetch: net.fetchFn, now }, TARGET);
const run = (cmd: ReturnType<typeof command>, req: ReturnType<typeof signed>) => cmd.handle(req.signature, req.timestamp, req.body);

describe('/status command', () => {
  test('answers Discord\'s ping', async () => {
    const res = await run(command(fakeNet([])), signed('{"type":1}'));
    expect(res).toEqual({ status: 200, body: { type: 1 } });
  });

  test('refuses anything Discord did not sign: no headers, a wrong signature, a changed body, an old request', async () => {
    const cmd = command(fakeNet([down]));
    const good = signed(useStatus);
    const refused = { status: 401, body: { error: 'unauthorized' } };
    expect(await cmd.handle(undefined, undefined, good.body)).toEqual(refused);
    expect(await cmd.handle('00'.repeat(64), good.timestamp, good.body)).toEqual(refused);
    expect(await cmd.handle('not hex', good.timestamp, good.body)).toEqual(refused);
    expect(await cmd.handle(good.signature, good.timestamp, good.body.replace('status', 'statuz'))).toEqual(refused);
    expect(await run(cmd, signed(useStatus, NOW - 6 * 60_000))).toEqual(refused);
    // A stranger's key signs correctly, just not as Discord.
    const stranger = generateKeyPairSync('ed25519').privateKey;
    const forged = sign(null, Buffer.from(good.timestamp + good.body), stranger).toString('hex');
    expect(await cmd.handle(forged, good.timestamp, good.body)).toEqual(refused);
  });

  test('defers, then fills in the TSS incident that changed last, with mentions off', async () => {
    // The page lists uAchieve first and the long-running "known issues" before the outage.
    const net = fakeNet([other, known, down]);
    const res = await run(command(net), signed(useStatus));
    expect(res).toEqual({ status: 200, body: { type: 5 } });

    await vi.waitFor(() => expect(net.of('/webhooks/')).toHaveLength(1));
    const sent = net.of('/webhooks/')[0]!;
    expect([sent.method, sent.url, sent.auth]).toEqual(['PATCH', FOLLOW_UP, null]);
    expect(sent.body).toEqual({
      content: '**TSS Down** — resolved\nThis incident has been resolved.\nhttps://stspg.io/9jh550cp9275',
      allowed_mentions: { parse: [] },
    });
  });

  test('says so when the page lists no TSS incident, and when the page cannot be read', async () => {
    const quiet = fakeNet([other]);
    await run(command(quiet), signed(useStatus));
    await vi.waitFor(() => expect(quiet.of('/webhooks/')).toHaveLength(1));
    expect(quiet.of('/webhooks/')[0]!.body).toMatchObject({ content: 'status.ucsd.edu lists no TSS incident right now.' });

    const broken = fakeNet([down], { listStatus: 503 });
    await run(command(broken), signed(useStatus));
    await vi.waitFor(() => expect(broken.of('/webhooks/')).toHaveLength(1));
    expect(broken.of('/webhooks/')[0]!.body).toMatchObject({ content: 'Could not read status.ucsd.edu just now. Try again in a minute.' });
    expect(err).toHaveBeenCalledWith('Status command failed: status page responded 503');
  });

  test('reads the status page at most six times a minute, and says so past that', async () => {
    const net = fakeNet([down]);
    const cmd = command(net);
    for (let i = 0; i < 8; i++) await run(cmd, signed(useStatus));
    await vi.waitFor(() => expect(net.of('/webhooks/')).toHaveLength(8));
    expect(net.of(LIST)).toHaveLength(6);
    expect(net.of('/webhooks/').filter((c) => (c.body as { content: string }).content.startsWith('Too many checks'))).toHaveLength(2);
  });

  test('a command it does not know gets a private "Unknown command."', async () => {
    const net = fakeNet([down]);
    const res = await run(command(net), signed(JSON.stringify({ type: 2, token: 't', data: { name: 'other' } })));
    expect(res).toEqual({ status: 200, body: { type: 4, data: { content: 'Unknown command.', flags: 64 } } });
    expect(net.of(LIST)).toHaveLength(0);
  });

  test('asks Discord who the bot is once; after a failure it refuses, and asks again a minute later', async () => {
    const net = fakeNet([down], { appStatus: 401 });
    let t = NOW;
    const cmd = command(net, () => new Date(t));
    expect((await run(cmd, signed('{"type":1}', t))).status).toBe(401);
    expect((await run(cmd, signed('{"type":1}', t))).status).toBe(401);
    expect(net.of('/applications/@me')).toHaveLength(1);
    expect(err).toHaveBeenCalledWith('Status command is off: Discord responded 401');
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-token');

    net.opts.appStatus = 200;
    t += 61_000;
    expect((await run(cmd, signed('{"type":1}', t))).status).toBe(200);
    expect((await run(cmd, signed('{"type":1}', t))).status).toBe(200);
    expect(net.of('/applications/@me')).toHaveLength(2);
    expect(net.of('/applications/@me')[0]!.auth).toBe('Bot secret-token');
  });
});

describe('registerStatusCommand', () => {
  test('creates /status under the bot\'s own application', async () => {
    const net = fakeNet([]);
    await registerStatusCommand({ fetch: net.fetchFn }, TARGET);
    const post = net.calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`https://discord.com/api/v10/applications/${APP_ID}/commands`);
    expect(post.auth).toBe('Bot secret-token');
    expect(post.body).toEqual({ name: 'status', description: 'Latest TSS update from the UCSD status page', type: 1 });
    expect(log).toHaveBeenCalledWith('Status command: /status registered');
  });

  test('a failure is one log line without the token', async () => {
    await registerStatusCommand({ fetch: fakeNet([], { appStatus: 401 }).fetchFn }, TARGET);
    expect(err).toHaveBeenCalledWith('Status command registration failed: Discord responded 401');
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-token');
  });
});

describe('POST /api/hooks/discord', () => {
  const post = (app: ReturnType<typeof createApp>, req: Partial<ReturnType<typeof signed>> & { body: string }) =>
    // As Discord sends it: no Origin header.
    app.request('/api/hooks/discord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.signature ? { 'X-Signature-Ed25519': req.signature, 'X-Signature-Timestamp': req.timestamp! } : {}),
      },
      body: req.body,
    });

  test('reaches the command without an Origin header: a signed ping is answered, an unsigned one is 401', async () => {
    const net = fakeNet([down]);
    const deps = testDeps({ fetch: net.fetchFn, now: () => new Date(NOW) });
    deps.config.statusRelay = TARGET;
    const app = createApp(deps);

    const ok = await post(app, signed('{"type":1}'));
    expect([ok.status, await ok.json()]).toEqual([200, { type: 1 }]);
    const unsigned = await post(app, { body: '{"type":1}' });
    expect([unsigned.status, await unsigned.json()]).toEqual([401, { error: 'unauthorized' }]);
  });

  test('with no bot configured there is no endpoint', async () => {
    const res = await post(createApp(testDeps()), signed('{"type":1}'));
    expect(res.status).toBe(404);
  });
});

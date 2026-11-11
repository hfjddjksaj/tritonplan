import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { testDeps } from '../test-helpers';
import { createStatusRelay, formatIncident } from './relay';

const HOOK = 'https://discord.com/api/webhooks/123/secret-token';
const LIST = 'https://status.ucsd.edu/api/v2/incidents.json';

interface Update { id: string; body: string }
interface Incident { id: string; name: string; status: string; shortlink?: string; incident_updates: Update[] }

const tss = (updates: Update[], status = 'investigating'): Incident => ({
  id: 'hm72y9krwjqx',
  name: 'TSS Down',
  status,
  shortlink: 'https://stspg.io/9jh550cp9275',
  incident_updates: updates,
});
const other: Incident = {
  id: 'p492l570j1ys',
  name: 'uAchieve Down',
  status: 'investigating',
  incident_updates: [{ id: 'x1', body: 'Audits cannot be run.' }],
};

/** A fetch that serves the status page's list from `lists` (one per call, the last one repeating) and plays Discord. */
function fakeNet(lists: Incident[][], discordStatus = 204) {
  const sent: { url: string; body: { content: string; allowed_mentions: unknown } }[] = [];
  let listCalls = 0;
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url === LIST) {
      const incidents = lists[Math.min(listCalls++, lists.length - 1)];
      return new Response(JSON.stringify({ incidents }), { status: 200 });
    }
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: discordStatus });
  }) as typeof fetch;
  return { fetchFn, sent, listCalls: () => listCalls };
}

const delivery = (id: string, updateId?: string) => ({
  page: { id: 'vl1y9mn0nbkh' },
  // What a forger controls. None of it may reach Discord.
  incident: { id, name: 'TSS forged name', status: 'resolved', incident_updates: updateId ? [{ id: updateId, body: 'forged body' }] : [] },
});

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

const now = () => new Date('2026-11-10T23:00:00.000Z');
const noWait = () => Promise.resolve();

describe('status relay', () => {
  test('posts the newest update of a TSS incident, in the status page\'s words, with mentions off', async () => {
    const net = fakeNet([[other, tss([{ id: 'u2', body: 'This incident has been resolved.' }, { id: 'u1', body: 'Investigating.' }], 'resolved')]]);
    await createStatusRelay({ fetch: net.fetchFn, now }, HOOK, noWait).handle(delivery('hm72y9krwjqx', 'u2'));

    expect(net.sent).toHaveLength(1);
    expect(net.sent[0]!.url).toBe(HOOK);
    expect(net.sent[0]!.body.content).toBe('**TSS Down** — resolved\nThis incident has been resolved.\nhttps://stspg.io/9jh550cp9275');
    expect(net.sent[0]!.body.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(net.sent)).not.toContain('forged');
  });

  test('one update is posted once; the next update of the same incident is posted too', async () => {
    const first = [tss([{ id: 'u1', body: 'Investigating.' }])];
    const second = [tss([{ id: 'u2', body: 'Fixed.' }, { id: 'u1', body: 'Investigating.' }], 'resolved')];
    const net = fakeNet([first, first, second]);
    const relay = createStatusRelay({ fetch: net.fetchFn, now }, HOOK, noWait);

    await relay.handle(delivery('hm72y9krwjqx', 'u1'));
    await relay.handle(delivery('hm72y9krwjqx', 'u1'));
    expect(net.sent).toHaveLength(1);
    await relay.handle(delivery('hm72y9krwjqx', 'u2'));
    expect(net.sent.map((s) => s.body.content.split('\n')[1])).toEqual(['Investigating.', 'Fixed.']);
  });

  test('an incident that is not about TSS, or not on the status page at all, posts nothing', async () => {
    const net = fakeNet([[other]]);
    const relay = createStatusRelay({ fetch: net.fetchFn, now }, HOOK, noWait);
    await relay.handle(delivery('p492l570j1ys', 'x1')); // real, but uAchieve; the forged name says TSS
    await relay.handle(delivery('zzzzzzzzzzzz', 'u9')); // made up
    expect(net.sent).toHaveLength(0);
  });

  test('a delivery with no incident never reaches the status page', async () => {
    const net = fakeNet([[other]]);
    const relay = createStatusRelay({ fetch: net.fetchFn, now }, HOOK, noWait);
    for (const payload of [null, 'text', {}, { component: { name: 'Academic Services' } }, { incident: { id: '../etc' } }]) {
      await relay.handle(payload);
    }
    expect(net.listCalls()).toBe(0);
    expect(net.sent).toHaveLength(0);
  });

  test('a delivery that is ahead of the status page\'s list waits and looks once more', async () => {
    const stale = [tss([{ id: 'u1', body: 'Investigating.' }])];
    const fresh = [tss([{ id: 'u2', body: 'Fixed.' }, { id: 'u1', body: 'Investigating.' }], 'resolved')];
    const net = fakeNet([stale, stale, fresh]);
    const waits: number[] = [];
    const relay = createStatusRelay({ fetch: net.fetchFn, now }, HOOK, async (ms) => void waits.push(ms));

    await relay.handle(delivery('hm72y9krwjqx', 'u1'));
    await relay.handle(delivery('hm72y9krwjqx', 'u2')); // list still shows u1
    expect(waits).toEqual([3000]);
    expect(net.sent.map((s) => s.body.content.split('\n')[1])).toEqual(['Investigating.', 'Fixed.']);
  });

  test('at most six looks at the status page per minute, however many deliveries arrive', async () => {
    const net = fakeNet([[other]]);
    let t = Date.parse('2026-11-10T23:00:00.000Z');
    const relay = createStatusRelay({ fetch: net.fetchFn, now: () => new Date(t) }, HOOK, noWait);
    for (let i = 0; i < 20; i++) await relay.handle(delivery('zzzzzzzzzzzz'));
    expect(net.listCalls()).toBe(6);
    t += 61_000;
    await relay.handle(delivery('zzzzzzzzzzzz'));
    expect(net.listCalls()).toBe(7);
  });

  test('a refused post is logged without the webhook address and tried again on the next delivery', async () => {
    const list = [tss([{ id: 'u1', body: 'Investigating.' }])];
    const down = fakeNet([list], 500);
    let fetchFn = down.fetchFn;
    const relay = createStatusRelay({ fetch: ((...a: Parameters<typeof fetch>) => fetchFn(...a)) as typeof fetch, now }, HOOK, noWait);

    await relay.handle(delivery('hm72y9krwjqx', 'u1'));
    expect(err).toHaveBeenCalledWith('Status relay failed: Discord responded 500');
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-token');

    const up = fakeNet([list]);
    fetchFn = up.fetchFn;
    await relay.handle(delivery('hm72y9krwjqx', 'u1'));
    expect(up.sent).toHaveLength(1);
  });

  test('a broken answer from the status page is one log line and no post', async () => {
    const fetchFn = (async () => new Response('<html>503</html>', { status: 503 })) as unknown as typeof fetch;
    await createStatusRelay({ fetch: fetchFn, now }, HOOK, noWait).handle(delivery('hm72y9krwjqx', 'u1'));
    expect(err).toHaveBeenCalledWith('Status relay failed: status page responded 503');
  });

  test('formatIncident drops HTML tags and stays under Discord\'s limit', () => {
    const linked = formatIncident(tss([{ id: 'u1', body: 'See <a href="https://x.test/doc">Known Issues</a>.\n' }]));
    expect(linked).toBe('**TSS Down** — investigating\nSee Known Issues.\nhttps://stspg.io/9jh550cp9275');
    expect(formatIncident(tss([{ id: 'u1', body: 'x'.repeat(5000) }])).length).toBe(1900);
  });
});

describe('POST /api/hooks/ucsd-status', () => {
  const post = (app: ReturnType<typeof createApp>, path: string, body: string) =>
    // As the status page sends it: no Origin header.
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

  test('accepts the status page (no Origin) and relays in the background', async () => {
    const net = fakeNet([[tss([{ id: 'u1', body: 'Investigating.' }])]]);
    const deps = testDeps({ fetch: net.fetchFn });
    deps.config.discordStatusWebhook = HOOK;
    const app = createApp(deps);

    const res = await post(app, '/api/hooks/ucsd-status', JSON.stringify(delivery('hm72y9krwjqx', 'u1')));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(net.sent).toHaveLength(1));
    expect((await (await app.request('/api/hooks/ucsd-status')).json())).toEqual({ relay: 'on' });
  });

  test('with no webhook configured it still answers 200 and does nothing', async () => {
    const app = createApp(testDeps()); // testDeps' fetch rejects if anything calls it
    const res = await post(app, '/api/hooks/ucsd-status', JSON.stringify(delivery('hm72y9krwjqx', 'u1')));
    expect(res.status).toBe(200);
    expect((await (await app.request('/api/hooks/ucsd-status')).json())).toEqual({ relay: 'off' });
    expect(err).not.toHaveBeenCalled();
  });

  test('a body that is not JSON is 200; one over 256 KB is 413', async () => {
    const app = createApp(testDeps());
    expect((await post(app, '/api/hooks/ucsd-status', 'not json')).status).toBe(200);
    expect((await post(app, '/api/hooks/ucsd-status', JSON.stringify({ pad: 'x'.repeat(300 * 1024) }))).status).toBe(413);
  });

  test('the same-origin guard still covers every other write, under /api/hooks too', async () => {
    const app = createApp(testDeps());
    expect((await post(app, '/api/hooks/other', '{}')).status).toBe(403);
    expect((await post(app, '/api/auth/login', '{}')).status).toBe(403);
    expect((await app.request('/api/hooks/ucsd-status', { method: 'DELETE' })).status).toBe(403);
  });
});

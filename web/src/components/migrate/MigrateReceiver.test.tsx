import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MigrateReceiver } from './MigrateReceiver';
import { OLD_SITE_ORIGIN } from '../../lib/site';
import { isMigrationPayload, loadPendingMigration, MIGRATE_MSG, MIGRATION_PENDING_KEY, type MigrationPayload } from '../../lib/migration';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAYLOAD: MigrationPayload = {
  kind: 'tritonplan-migration', version: 1, exportedAt: '2026-10-01T00:00:00.000Z',
  terms: null, plans: null, plan: null, pool: [], appt: null, received: null, hashPlan: null,
};
const WAITING = 'Moving your plans from the old TritonPlan…';
const FALLBACK = "Didn't work? Download a backup file on the old site and import it here.";
const NOT_BACKUP = "That file isn't a TritonPlan backup.";

let container: HTMLDivElement;
let root: Root;
let opener: Window;
let postSpy: ReturnType<typeof vi.fn>;
const onReceived = vi.fn();

function setOpener(w: Window | null) {
  Object.defineProperty(window, 'opener', { configurable: true, value: w });
}
async function render() {
  await act(async () => root.render(<MigrateReceiver onReceived={onReceived} />));
}
/** A message as the browser delivers it: origin and source are set by the sender's window, not by the payload. */
function message(data: unknown, o: { origin?: string; source?: Window | null } = {}) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: o.origin ?? OLD_SITE_ORIGIN, source: o.source === undefined ? opener : o.source }));
  });
}
const text = () => container.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  onReceived.mockReset();
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  opener = frame.contentWindow!;
  postSpy = vi.fn();
  (opener as unknown as { postMessage: unknown }).postMessage = postSpy;
  setOpener(opener);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll('iframe').forEach((f) => f.remove());
  setOpener(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MigrateReceiver', () => {
  it('accepts a payload only from the old site origin, stores it and acks', async () => {
    await render();
    expect(text()).toContain(WAITING);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith({ type: MIGRATE_MSG.ready }, OLD_SITE_ORIGIN);

    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD }, { origin: 'https://evil.example' });
    expect(loadPendingMigration()).toBeNull();
    expect(onReceived).not.toHaveBeenCalled();

    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD });
    expect(loadPendingMigration()).toEqual(PAYLOAD);
    expect(postSpy).toHaveBeenLastCalledWith({ type: MIGRATE_MSG.ack }, OLD_SITE_ORIGIN);
    expect(onReceived).toHaveBeenCalledTimes(1);

    // One accepted payload ends the listening.
    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD });
    expect(onReceived).toHaveBeenCalledTimes(1);
  });

  it('under StrictMode ready is posted once and a payload is handled once', async () => {
    await act(async () => root.render(<StrictMode><MigrateReceiver onReceived={onReceived} /></StrictMode>));
    expect(postSpy).toHaveBeenCalledTimes(1);
    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD });
    expect(onReceived).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('ignores a message from the right origin but another window', async () => {
    await render();
    const other = document.body.appendChild(document.createElement('iframe')).contentWindow!;
    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD }, { source: other });
    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD }, { source: null });
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).toBeNull();
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('ignores a payload that fails validation and other message types', async () => {
    await render();
    expect(isMigrationPayload({ ...PAYLOAD, version: 2 })).toBe(false);
    message({ type: MIGRATE_MSG.payload, payload: { ...PAYLOAD, version: 2 } });
    message({ type: MIGRATE_MSG.ready, payload: PAYLOAD });
    message('tp-migrate-payload');
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).toBeNull();
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('without an opener it offers the backup-file import', async () => {
    setOpener(null);
    await render();
    expect(text()).toContain(FALLBACK);
    expect(text()).toContain('Import a backup file');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('offers the backup file after 8 s without a payload', async () => {
    await render();
    expect(text()).not.toContain(FALLBACK);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(text()).toContain(FALLBACK);
  });

  it('says so when the browser cannot hold the plans, and does not ack', async () => {
    await render();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    message({ type: MIGRATE_MSG.payload, payload: PAYLOAD });
    vi.restoreAllMocks();
    expect(text()).toContain("Your browser couldn't hold your plans for the move. Download a backup file on the old site and import it here.");
    expect(onReceived).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalledWith({ type: MIGRATE_MSG.ack }, expect.anything());
  });

  async function pick(contents: string, size?: number) {
    setOpener(null);
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([contents], 'backup.json', { type: 'application/json' });
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  it('a valid backup file is stored as the pending migration', async () => {
    await pick(JSON.stringify(PAYLOAD));
    expect(loadPendingMigration()).toEqual(PAYLOAD);
    expect(onReceived).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not JSON', '{nope', undefined],
    ['not a backup', JSON.stringify({ hello: 1 }), undefined],
    ['over 20 MB', JSON.stringify(PAYLOAD), 20 * 1024 * 1024 + 1],
  ])('an invalid file (%s) shows the invalid-file copy and stores nothing', async (_n, contents, size) => {
    await pick(contents, size);
    expect(text()).toContain(NOT_BACKUP);
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).toBeNull();
    expect(onReceived).not.toHaveBeenCalled();
  });
});

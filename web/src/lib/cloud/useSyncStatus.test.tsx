import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SyncOp } from '@triton/shared';
import { createSyncEngine, useSyncStatus, type SyncEngine } from './engine';
import type { WebSnapshot } from './records';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const empty: WebSnapshot = { terms: {}, plans: {}, pool: [], appt: null };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

function Probe({ e }: { e: SyncEngine }) { return <span>{useSyncStatus(e)}</span>; }

describe('useSyncStatus', () => {
  it('renders the current status and re-renders when it changes', async () => {
    const send = vi.fn(async (_ops: SyncOp[]) => ({ ok: false, kind: 'network' }) as const);
    const e = createSyncEngine({ snapshot: empty, send });
    act(() => root.render(<Probe e={e} />));
    expect(host.textContent).toBe('idle');
    await act(async () => { e.setPool([{ id: 'x' } as never]); await vi.advanceTimersByTimeAsync(800); });
    expect(host.textContent).toBe('offline');
    e.dispose();
  });
});

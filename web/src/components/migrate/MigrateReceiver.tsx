/**
 * /migrate with nothing pending: the old site's page opened this tab and will
 * hand over the plans by postMessage. Only a message from the old site's
 * origin AND from the window that opened us counts — anything else on the
 * web can message a window — and replies go to that origin only. When no
 * payload comes (no opener, a blocked pop-up relationship, a slow page), the
 * student can import the backup file the old site offers instead.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { isMigrationPayload, MIGRATE_MSG, savePendingMigration, type MigrationPayload } from '../../lib/migration';
import { OLD_SITE_ORIGIN } from '../../lib/site';
import { AuthCard, AuthMessage } from '../auth/AuthCard';

const WAIT_MS = 8000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const NOT_BACKUP = "That file isn't a TritonPlan backup.";
const CANT_HOLD =
  "Your browser couldn't hold your plans for the move. Download a backup file on the old site and import it here.";

/** FileReader rather than Blob.text(): older Safari lacks the latter. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function MigrateReceiver({ onReceived }: { onReceived: () => void }) {
  const [fallback, setFallback] = useState(() => !window.opener);
  const [error, setError] = useState<string | null>(null);
  // Refs survive StrictMode's mount/unmount/mount, so `ready` goes out once.
  const readySent = useRef(false);
  const received = useRef(false);

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    const onMessage = (e: MessageEvent) => {
      if (received.current || e.origin !== OLD_SITE_ORIGIN || e.source !== window.opener) return;
      const data: unknown = e.data;
      if (!data || typeof data !== 'object') return;
      const { type, payload } = data as { type?: unknown; payload?: unknown };
      if (type !== MIGRATE_MSG.payload || !isMigrationPayload(payload)) return;
      received.current = true;
      window.removeEventListener('message', onMessage);
      if (!savePendingMigration(payload)) {
        // No ack: the old page must not report the move as done.
        setError(CANT_HOLD);
        setFallback(true);
        return;
      }
      opener.postMessage({ type: MIGRATE_MSG.ack }, OLD_SITE_ORIGIN);
      onReceived();
    };
    window.addEventListener('message', onMessage);
    if (!readySent.current) {
      readySent.current = true;
      opener.postMessage({ type: MIGRATE_MSG.ready }, OLD_SITE_ORIGIN);
    }
    const timer = setTimeout(() => setFallback(true), WAIT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [onReceived]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    let payload: MigrationPayload | null = null;
    if (file.size <= MAX_FILE_BYTES) {
      try {
        const parsed: unknown = JSON.parse(await readText(file));
        if (isMigrationPayload(parsed)) payload = parsed;
      } catch {
        /* falls through to the invalid-file copy */
      }
    }
    if (!payload) return setError(NOT_BACKUP);
    if (!savePendingMigration(payload)) return setError(CANT_HOLD);
    received.current = true;
    onReceived();
  }

  return (
    <AuthCard heading="Moving your plans from the old TritonPlan…">
      {error && <AuthMessage tone="error">{error}</AuthMessage>}
      {fallback && (
        <>
          <p className="auth__lede">Didn't work? Download a backup file on the old site and import it here.</p>
          <label className="btn auth__wide">
            Import a backup file
            <input type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e)} />
          </label>
        </>
      )}
    </AuthCard>
  );
}

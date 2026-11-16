/**
 * Which entry a server bundle was built from, and deploy.sh's guard on it.
 *
 * build.mjs builds a checkout's own entry (src/local/main.ts, gitignored) when there is one, and writes the
 * entry it used on the bundle's first line. A release built from such an entry does more than this
 * repository's server does. A plain build that replaced it would drop that, and nothing would fail: the health
 * check passes either way. So deploy.sh reads the line off the bundle in production, and stops unless the loss
 * is asked for with TP_REPLACE_LOCAL_ENTRY=1.
 *
 *   node entry.mjs "<start of the bundle in production>" "<start of the new bundle>"
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The entry every checkout has. */
export const REPO_ENTRY = 'src/main.ts';
const MARK = '// entry: ';

/** The first line of a bundle built from `entry`. */
export const entryLine = (entry) => `${MARK}${entry}`;

/** The entry named on the first line of `text`; null when it names none (an older bundle, or no bundle). */
export function entryOf(text) {
  const first = String(text ?? '').split(/\r?\n/, 1)[0];
  if (!first.startsWith(MARK)) return null;
  return first.slice(MARK.length).trim() || null;
}

/**
 * May the bundle starting with `next` replace the one starting with `live`? Refused only when production was
 * built from an entry of a checkout's own and this build was not. A bundle that does not say what it was built
 * from counts as plain on the new side (it cannot be shown to carry anything) and as unknown in production.
 */
export function checkEntry({ live, next, allow = false }) {
  const liveEntry = entryOf(live);
  const nextEntry = entryOf(next);
  const sides = `entry: production ${liveEntry ?? 'unmarked'}, this build ${nextEntry ?? 'unmarked'}`;
  const drops = liveEntry !== null && liveEntry !== REPO_ENTRY && (nextEntry ?? REPO_ENTRY) === REPO_ENTRY;
  if (!drops) return { ok: true, message: sides };
  if (allow) {
    return {
      ok: true,
      message: `${sides}\nwarning: TP_REPLACE_LOCAL_ENTRY is set: replacing a release built from ${liveEntry} with the plain server`,
    };
  }
  return {
    ok: false,
    message: [
      sides,
      `error: the release in production was built from ${liveEntry}, which this checkout does not have.`,
      'This build would drop whatever that entry adds to the server, and nothing would fail.',
      'Deploy from the checkout that has server/src/local/, or set TP_REPLACE_LOCAL_ENTRY=1 to replace it with the plain server.',
    ].join('\n'),
  };
}

// Run as a script by deploy.sh; imported by build.mjs and the tests.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked.toLowerCase() === realpathSync(fileURLToPath(import.meta.url)).toLowerCase()) {
  const [live = '', next = ''] = process.argv.slice(2);
  const res = checkEntry({ live, next, allow: process.env.TP_REPLACE_LOCAL_ENTRY === '1' });
  (res.ok ? console.log : console.error)(res.message);
  process.exit(res.ok ? 0 : 1);
}

import { describe, expect, test } from 'vitest';
import { checkEntry, entryLine, entryOf, REPO_ENTRY } from './entry.mjs';

const LOCAL = 'src/local/main.ts';
const unmarked = "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

describe('the entry a bundle names on its first line', () => {
  test('is written as a comment and read back', () => {
    expect(entryLine(LOCAL)).toBe('// entry: src/local/main.ts');
    expect(entryOf(entryLine(LOCAL))).toBe(LOCAL);
    expect(entryOf(entryLine(REPO_ENTRY))).toBe('src/main.ts');
  });

  test('is read off the first line only, whatever the line ending', () => {
    expect(entryOf(`${entryLine(LOCAL)}\r\n${unmarked}`)).toBe(LOCAL);
    expect(entryOf(`${unmarked}\n${entryLine(LOCAL)}`)).toBeNull();
  });

  test('is unknown for a bundle from before the line existed, and for no bundle at all', () => {
    expect(entryOf(unmarked)).toBeNull();
    expect(entryOf('')).toBeNull();
    expect(entryOf(undefined)).toBeNull();
  });
});

describe('checkEntry: may this bundle replace the one in production?', () => {
  const check = (live, next, allow = false) => checkEntry({ live, next, allow });

  test('a plain bundle may not replace one built from a local entry', () => {
    const res = check(entryLine(LOCAL), entryLine(REPO_ENTRY));
    expect(res.ok).toBe(false);
    expect(res.message).toContain(LOCAL);
    expect(res.message).toContain('TP_REPLACE_LOCAL_ENTRY=1');
  });

  test('a bundle that does not say what it was built from counts as plain', () => {
    expect(check(entryLine(LOCAL), unmarked).ok).toBe(false);
    expect(check(entryLine(LOCAL), '').ok).toBe(false);
  });

  test('it may when that is asked for, and the answer still says what is being dropped', () => {
    const res = check(entryLine(LOCAL), entryLine(REPO_ENTRY), true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain(LOCAL);
  });

  test.each([
    ['the same local entry', entryLine(LOCAL), entryLine(LOCAL)],
    ['plain over plain', entryLine(REPO_ENTRY), entryLine(REPO_ENTRY)],
    ['a local entry over a plain release', entryLine(REPO_ENTRY), entryLine(LOCAL)],
    ['anything over a release from before the line existed', unmarked, entryLine(REPO_ENTRY)],
    ['the first release on a new server', '', entryLine(REPO_ENTRY)],
  ])('%s goes through', (_name, live, next) => {
    expect(check(live, next).ok).toBe(true);
  });

  test('every answer names both sides, for the deploy log', () => {
    expect(check(entryLine(LOCAL), entryLine(LOCAL)).message).toBe('entry: production src/local/main.ts, this build src/local/main.ts');
    expect(check(unmarked, entryLine(REPO_ENTRY)).message).toBe('entry: production unmarked, this build src/main.ts');
  });
});

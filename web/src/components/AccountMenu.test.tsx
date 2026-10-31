import { MIGRATION_PENDING_KEY } from '../lib/migration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Me } from '../lib/cloud/api';
import { nav } from '../lib/nav';
import type { TermsState } from '../lib/terms-state';
import { AccountMenu } from './AccountMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECEIVED_KEY = 'triton-planner:received:v1';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let container: HTMLDivElement;
let root: Root;
let answers: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.spyOn>;
const flash = vi.fn();
let flush: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  flash.mockClear();
  flush = vi.fn(async () => {});
  answers = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    (answers[`${init?.method} ${url}`] ?? (() => json(500, { error: 'server' })))(),
  );
  vi.stubGlobal('fetch', fetchMock);
  assign = vi.spyOn(nav, 'assign').mockImplementation(() => {});
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noTerms = { version: 1, activeTermKey: '', terms: {} } as TermsState;
const both: Me = { email: 'Student@ucsd.edu', hasPassword: true, hasGoogle: true };
async function render(me: Me = both) {
  await act(async () => root.render(<AccountMenu me={me} terms={noTerms} onFlash={flash} flush={flush} />));
}
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const buttons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());
async function click(label: string) {
  const el = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no button "${label}" among ${buttons().join('|')}`);
  await act(async () => {
    el.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const openMenu = () => act(async () => q('button[aria-haspopup="menu"]')!.click());
function type(sel: string, value: string) {
  const el = q(sel) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const bodies = (url: string) =>
  fetchMock.mock.calls.filter((c) => c[0] === url).map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe('AccountMenu items', () => {
  it('lists email, Change password, Disconnect Google, Delete account…, Sign out', async () => {
    await render();
    await openMenu();
    expect(q('[role="menu"]')!.textContent).toContain('Student@ucsd.edu');
    expect(buttons()).toEqual(
      expect.arrayContaining(['Change password', 'Disconnect Google', 'Delete account…', 'Sign out']),
    );
    expect(buttons()).not.toContain('Set a password');
  });

  it('Import from old TritonPlan saves pending edits, then opens the import page; share links are gone', async () => {
    await render();
    await openMenu();
    expect(buttons()).not.toContain('Shared links');
    await click('Import from old TritonPlan');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/migrate');
  });

  it('Google-only: Set a password, no Change password, no Disconnect Google', async () => {
    await render({ email: 'g@ucsd.edu', hasPassword: false, hasGoogle: true });
    await openMenu();
    expect(buttons()).toContain('Set a password');
    expect(buttons()).not.toContain('Change password');
    expect(buttons()).not.toContain('Disconnect Google');
  });

  it('password-only: no Disconnect Google', async () => {
    await render({ email: 'p@ucsd.edu', hasPassword: true, hasGoogle: false });
    await openMenu();
    expect(buttons()).not.toContain('Disconnect Google');
  });

  it('Set a password mails the link and says so', async () => {
    answers['POST /api/account/password-link'] = () => json(200, { ok: true });
    await render({ email: 'g@ucsd.edu', hasPassword: false, hasGoogle: true });
    await openMenu();
    await click('Set a password');
    expect(flash).toHaveBeenCalledWith('We emailed you a link to set a password.');
  });

  it('Disconnect Google flashes, then the menu stops offering it', async () => {
    answers['POST /api/account/google/unlink'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Disconnect Google');
    expect(flash).toHaveBeenCalledWith('Google is disconnected from your account.');
    await openMenu();
    expect(buttons()).not.toContain('Disconnect Google');
  });

  it('Disconnect Google needs_password reads as a hint', async () => {
    answers['POST /api/account/google/unlink'] = () => json(400, { error: 'needs_password' });
    await render();
    await openMenu();
    await click('Disconnect Google');
    expect(flash).toHaveBeenCalledWith('Set a password first, so you can still sign in.');
  });

  it('any other failure flashes the generic line', async () => {
    await render();
    await openMenu();
    await click('Disconnect Google');
    expect(flash).toHaveBeenCalledWith('Something went wrong. Please try again.');
  });
});

describe('sign out', () => {
  it('clears the received plan and leaves the page', async () => {
    localStorage.setItem(RECEIVED_KEY, '{"x":1}');
    answers['POST /api/auth/logout'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Sign out');
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/logout')).toBe(true);
    expect(localStorage.getItem(RECEIVED_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('drops a pending migration so the next person on this browser does not inherit it', async () => {
    localStorage.setItem(MIGRATION_PENDING_KEY, '{"x":1}');
    answers['POST /api/auth/logout'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Sign out');
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).toBeNull();
  });

  it('saves pending edits before ending the session', async () => {
    let saved!: () => void;
    flush.mockImplementation(() => new Promise<void>((r) => { saved = r; }));
    answers['POST /api/auth/logout'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Sign out');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/logout')).toBe(false);
    await act(async () => {
      saved();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/logout')).toBe(true);
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('a save that never finishes holds sign-out for at most 3 s', async () => {
    vi.useFakeTimers();
    try {
      flush.mockImplementation(() => new Promise<void>(() => {}));
      answers['POST /api/auth/logout'] = () => json(200, { ok: true });
      await render();
      await openMenu();
      await click('Sign out');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2900);
      });
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/logout')).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/logout')).toBe(true);
      expect(assign).toHaveBeenCalledWith('/');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a save that fails still signs out', async () => {
    flush.mockImplementation(() => Promise.reject(new Error('offline')));
    answers['POST /api/auth/logout'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Sign out');
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('still clears and leaves when the logout call fails', async () => {
    localStorage.setItem(RECEIVED_KEY, '{"x":1}');
    await render();
    await openMenu();
    await click('Sign out');
    expect(localStorage.getItem(RECEIVED_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith('/');
  });
});

describe('delete account', () => {
  const del = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Delete account')!;

  it('stays disabled until the typed email matches (case and edge spaces ignored)', async () => {
    answers['DELETE /api/account'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Delete account…');
    expect(q('[role="dialog"]')!.textContent).toContain(
      "This deletes your account, every plan in it, your shared links and your calendar link. It can't be undone.",
    );
    expect(del().disabled).toBe(true);
    type('input[type="email"]', 'someone@else.edu');
    expect(del().disabled).toBe(true);
    type('input[type="email"]', '  student@UCSD.edu ');
    expect(del().disabled).toBe(false);
    await click('Delete account');
    expect(bodies('/api/account')).toEqual([{ confirmEmail: '  student@UCSD.edu '.trim() }]);
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('a deleted account leaves no pending migration or received plan behind on this browser', async () => {
    localStorage.setItem(RECEIVED_KEY, '{"x":1}');
    localStorage.setItem(MIGRATION_PENDING_KEY, '{"x":1}');
    answers['DELETE /api/account'] = () => json(200, { ok: true });
    await render();
    await openMenu();
    await click('Delete account…');
    type('input[type="email"]', 'student@ucsd.edu');
    await click('Delete account');
    expect(localStorage.getItem(RECEIVED_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_PENDING_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('a 400 shows the generic copy and stays', async () => {
    localStorage.setItem(RECEIVED_KEY, '{"x":1}');
    answers['DELETE /api/account'] = () => json(400, { error: 'confirm_mismatch' });
    await render();
    await openMenu();
    await click('Delete account…');
    type('input[type="email"]', 'student@ucsd.edu');
    await click('Delete account');
    expect(q('[role="alert"]')!.textContent).toBe('Something went wrong. Please try again.');
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECEIVED_KEY)).toBe('{"x":1}'); // nothing was deleted, so nothing is cleared
  });

  it('Escape closes the dialog', async () => {
    await render();
    await openMenu();
    await click('Delete account…');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(q('[role="dialog"]')).toBeNull();
  });
});

describe('change password', () => {
  async function open() {
    await render();
    await openMenu();
    await click('Change password');
  }
  function fill(confirm = 'new password 1') {
    type('input[autocomplete="current-password"]', 'old password');
    type('input[name="next"]', 'new password 1');
    type('input[name="confirm"]', confirm);
  }
  async function save() {
    const form = q('[role="dialog"] form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it('posts current and next, then closes and flashes', async () => {
    answers['POST /api/account/password'] = () => json(200, { ok: true });
    await open();
    expect((q('input[autocomplete="new-password"]') as HTMLInputElement).minLength).toBe(8);
    fill();
    await save();
    expect(bodies('/api/account/password')).toEqual([{ current: 'old password', next: 'new password 1' }]);
    expect(q('[role="dialog"]')).toBeNull();
    expect(flash).toHaveBeenCalledWith('Password changed.');
  });

  it('a new password typed differently twice is caught before anything is sent', async () => {
    answers['POST /api/account/password'] = () => json(200, { ok: true });
    await open();
    fill('new password 2');
    await save();
    expect(q('[role="alert"]')!.textContent).toBe("The passwords don't match.");
    expect(bodies('/api/account/password')).toEqual([]);
    expect(q('[role="dialog"]')).not.toBeNull();
  });

  it.each([
    [401, 'invalid_credentials', 'Your current password is wrong.'],
    [400, 'weak_password', 'Use at least 8 characters.'],
    [429, 'rate_limited', 'Too many attempts. Try again in 1 minute.'],
    [500, 'server', 'Something went wrong. Please try again.'],
  ])('%i reads as its own line', async (status, error, text) => {
    answers['POST /api/account/password'] = () => json(status, { error, retryAfter: 30 });
    await open();
    fill();
    await save();
    expect(q('[role="alert"]')!.textContent).toBe(text);
    expect(q('[role="dialog"]')).not.toBeNull();
  });
});

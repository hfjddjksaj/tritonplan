import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoginScreen } from './LoginScreen';
import { nav } from '../../lib/nav';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let container: HTMLDivElement;
let root: Root;
let answers: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let navSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  answers = {};
  fetchMock = vi.fn(async (url: string) => (answers[url] ?? (() => json(500, { error: 'server' })))());
  vi.stubGlobal('fetch', fetchMock);
  navSpy = vi.spyOn(nav, 'assign').mockImplementation(() => {});
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

async function render(props: Partial<Parameters<typeof LoginScreen>[0]> = {}) {
  await act(async () => root.render(<LoginScreen returnTo="/migrate" {...props} />));
}
const text = () => container.textContent ?? '';
function type(sel: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(sel);
  if (!el) throw new Error(`no ${sel}`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => {
    el.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
const sent = (url: string) =>
  fetchMock.mock.calls.filter((c) => c[0] === url).map((c) => JSON.parse((c[1] as RequestInit).body as string));

async function signIn(email = 'Me@ucsd.edu ', password = 'correct horse') {
  type('input[type="email"]', email);
  type('input[type="password"]', password);
  await click('Sign in');
}

describe('LoginScreen', () => {
  it('shows a custom heading and a Google link that returns to returnTo', async () => {
    await render({ heading: 'Sign in to finish moving your plans', notice: 'A notice' });
    expect(container.querySelector('h1')?.textContent).toBe('Sign in to finish moving your plans');
    expect(text()).toContain('A notice');
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2Fmigrate');
  });

  it('a good sign-in leaves for returnTo', async () => {
    answers['/api/auth/login'] = () => json(200, { ok: true });
    await render();
    await signIn();
    expect(sent('/api/auth/login')).toEqual([{ email: 'Me@ucsd.edu', password: 'correct horse' }]);
    expect(navSpy).toHaveBeenCalledWith('/migrate');
  });

  it('a returnTo that would leave the site falls back to /', async () => {
    answers['/api/auth/login'] = () => json(200, { ok: true });
    await render({ returnTo: '//evil.com' });
    const google = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Continue with Google'));
    expect(google?.getAttribute('href')).toBe('/api/auth/google?returnTo=%2F');
    await signIn();
    expect(navSpy).toHaveBeenCalledWith('/');
  });

  it('only a new password asks for 8 characters', async () => {
    await render();
    expect(container.querySelector('input[type="password"]')?.getAttribute('minlength')).toBeNull();
    await click('Create an account');
    expect(container.querySelector('input[type="password"]')?.getAttribute('minlength')).toBe('8');
  });

  it('401 → wrong email or password', async () => {
    answers['/api/auth/login'] = () => json(401, { error: 'invalid_credentials' });
    await render();
    await signIn();
    expect(text()).toContain('Wrong email or password.');
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('403 → confirm first, and Resend link mails a new one', async () => {
    answers['/api/auth/login'] = () => json(403, { error: 'unverified' });
    answers['/api/auth/resend'] = () => json(200, { ok: true });
    await render();
    await signIn();
    expect(text()).toContain('Confirm your email first — we sent a link to Me@ucsd.edu.');
    await click('Resend link');
    expect(sent('/api/auth/resend')).toEqual([{ email: 'Me@ucsd.edu' }]);
    expect(text()).toContain('Check your inbox at Me@ucsd.edu to confirm your account.');
  });

  it('429 → wait n minutes, rounded up', async () => {
    answers['/api/auth/login'] = () => json(429, { error: 'rate_limited', retryAfter: 801 });
    await render();
    await signIn();
    expect(text()).toContain('Too many attempts. Try again in 14 minutes.');
  });

  it('anything else → something went wrong', async () => {
    await render();
    await signIn();
    expect(text()).toContain('Something went wrong. Please try again.');
  });

  it('only sign-up asks for the password twice', async () => {
    await render();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    await click('Create an account');
    expect(container.querySelector('input[name="confirm"]')?.getAttribute('autocomplete')).toBe('new-password');
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2);
    await click('Sign in');
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it('two different passwords are caught before anything is sent', async () => {
    answers['/api/auth/signup'] = () => json(200, { ok: true });
    await render();
    await click('Create an account');
    type('input[type="email"]', 'new@ucsd.edu');
    type('input[name="password"]', 'long enough');
    type('input[name="confirm"]', 'long enougj');
    await click('Create account');
    expect(text()).toContain("The passwords don't match.");
    expect(sent('/api/auth/signup')).toEqual([]);
    type('input[name="confirm"]', 'long enough');
    await click('Create account');
    expect(sent('/api/auth/signup')).toEqual([{ email: 'new@ucsd.edu', password: 'long enough' }]);
  });

  it('sign-up success shows the check-email screen', async () => {
    answers['/api/auth/signup'] = () => json(200, { ok: true });
    await render();
    await click('Create an account');
    type('input[type="email"]', 'new@ucsd.edu');
    type('input[name="password"]', 'long enough');
    type('input[name="confirm"]', 'long enough');
    await click('Create account');
    expect(sent('/api/auth/signup')).toEqual([{ email: 'new@ucsd.edu', password: 'long enough' }]);
    expect(text()).toContain('Check your inbox at new@ucsd.edu to confirm your account.');
    expect(container.querySelector('input')).toBeNull();
  });

  it.each([
    [409, 'email_taken', 'An account with this email already exists. Sign in, or reset your password.'],
    [400, 'weak_password', 'Use at least 8 characters.'],
    [400, 'invalid_email', 'Enter a valid email address.'],
    [503, 'mail_failed', "We couldn't send the confirmation email right now. Try again in a few minutes, or continue with Google."],
  ])('sign-up %i %s says so', async (status, error, copy) => {
    answers['/api/auth/signup'] = () => json(status, { error });
    await render();
    await click('Create an account');
    type('input[type="email"]', 'new@ucsd.edu');
    type('input[name="password"]', 'pw');
    type('input[name="confirm"]', 'pw');
    await click('Create account');
    expect(text()).toContain(copy);
  });

  it('forgot password always answers the same way', async () => {
    answers['/api/auth/forgot'] = () => json(200, { ok: true });
    await render();
    await click('Forgot password?');
    type('input[type="email"]', 'who@ucsd.edu');
    await click('Send reset link');
    expect(sent('/api/auth/forgot')).toEqual([{ email: 'who@ucsd.edu' }]);
    expect(text()).toContain('If an account exists for who@ucsd.edu, a reset link is on its way.');
    await click('Back to sign in');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });
});

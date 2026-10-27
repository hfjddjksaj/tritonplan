import { expect, test } from 'vitest';
import { exchangeGoogleCode, googleAuthUrl, safeReturnTo } from './google';

const now = new Date('2026-01-15T12:00:00.000Z');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeIdToken = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

const good = { aud: 'cid', iss: 'https://accounts.google.com', exp: now.getTime() / 1000 + 600, sub: 's1', email: 'a@ucsd.edu', email_verified: true };
const exchange = (claims: Record<string, unknown>, status = 200) =>
  exchangeGoogleCode({
    code: 'c',
    codeVerifier: 'v',
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'https://tritonplan.cn/api/auth/google/callback',
    fetchFn: (async () => new Response(JSON.stringify({ id_token: fakeIdToken(claims) }), { status })) as unknown as typeof fetch,
    now,
  });

test('auth url carries PKCE, state and the three scopes', () => {
  const u = new URL(googleAuthUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 'st', codeChallenge: 'ch' }));
  expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(u.searchParams)).toEqual({
    client_id: 'cid',
    redirect_uri: 'https://x/cb',
    response_type: 'code',
    scope: 'openid email profile',
    state: 'st',
    code_challenge: 'ch',
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
});

test('exchange returns sub, email and emailVerified', async () => {
  expect(await exchange(good)).toEqual({ sub: 's1', email: 'a@ucsd.edu', emailVerified: true });
  expect((await exchange({ ...good, email_verified: 'true' })).emailVerified).toBe(false);
  expect((await exchange({ ...good, iss: 'accounts.google.com' })).sub).toBe('s1');
});

test('exchange rejects wrong aud, wrong iss, expired tokens, missing sub/email and failed responses', async () => {
  await expect(exchange({ ...good, aud: 'other' })).rejects.toThrow();
  await expect(exchange({ ...good, iss: 'https://evil.example' })).rejects.toThrow();
  await expect(exchange({ ...good, exp: now.getTime() / 1000 - 1 })).rejects.toThrow();
  await expect(exchange({ ...good, exp: undefined })).rejects.toThrow();
  await expect(exchange({ ...good, sub: undefined })).rejects.toThrow();
  await expect(exchange({ ...good, email: undefined })).rejects.toThrow();
  await expect(exchange(good, 400)).rejects.toThrow();
});

test('safeReturnTo keeps /migrate and rejects //evil.com, /\\evil.com, https://evil.com', () => {
  expect(safeReturnTo('/migrate')).toBe('/migrate');
  expect(safeReturnTo('/plan?x=1#y')).toBe('/plan?x=1#y');
  expect(safeReturnTo('/s/AbCdEfGh12')).toBe('/s/AbCdEfGh12'); // the web app's "Save to my account" on a short link
  for (const bad of [undefined, '', 'migrate', '//evil.com', '/\\evil.com', 'https://evil.com', '/\t/evil.com', '/\n/evil.com', '/a\\b', '\\\\evil.com']) {
    expect(safeReturnTo(bad)).toBe('/');
  }
});

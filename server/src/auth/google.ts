const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export function googleAuthUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${q}`;
}

export async function exchangeGoogleCode(p: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn: typeof fetch;
  now: Date;
}): Promise<{ sub: string; email: string; emailVerified: boolean; hd?: string }> {
  const res = await p.fetchFn(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: p.code,
      code_verifier: p.codeVerifier,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // Deliberately no response body or code in the message: this error may be logged.
  if (!res.ok) throw new Error(`google token endpoint answered ${res.status}`);
  // Parse failures get a fixed message: V8's own SyntaxError text quotes a snippet of the payload.
  let id_token: unknown;
  try {
    id_token = ((await res.json()) as { id_token?: unknown }).id_token;
  } catch {
    throw new Error('google token response is not JSON');
  }
  if (typeof id_token !== 'string') throw new Error('google response has no id_token');

  // The id_token's signature is not verified: we received it straight from Google's token endpoint over TLS
  // using our client secret, and OIDC Core §3.1.3.7 allows skipping signature validation in that case.
  // The claims below are still checked.
  const payload = id_token.split('.')[1];
  if (!payload) throw new Error('malformed id_token');
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('malformed id_token payload');
  }
  if (!c || typeof c !== 'object') throw new Error('malformed id_token payload');
  if (c.aud !== p.clientId) throw new Error('id_token audience mismatch');
  if (typeof c.iss !== 'string' || !ISSUERS.includes(c.iss)) throw new Error('id_token issuer mismatch');
  if (typeof c.exp !== 'number' || !(c.exp * 1000 > p.now.getTime())) throw new Error('id_token expired');
  if (typeof c.sub !== 'string' || !c.sub || typeof c.email !== 'string' || !c.email) throw new Error('id_token lacks sub or email');
  // Strictly boolean true: Google has sent the string form in some token types, and a string must not count as verified.
  return { sub: c.sub, email: c.email, emailVerified: c.email_verified === true, ...(typeof c.hd === 'string' && c.hd ? { hd: c.hd } : {}) };
}

/** Post-login redirect target; anything that could leave this origin collapses to '/'. */
export function safeReturnTo(raw: string | undefined): string {
  // Backslashes and control characters (tab, newline) are stripped or reinterpreted by browsers inside URLs,
  // so `/\evil.com` and `/\t/evil.com` can turn into `//evil.com`.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  return raw;
}

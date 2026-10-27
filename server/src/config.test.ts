import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

const base = { TP_ORIGIN: 'http://localhost:5173', TP_DB_PATH: ':memory:', TP_MAIL_TRANSPORT: 'console' };

describe('loadConfig', () => {
  test('missing required vars are all named', () => {
    expect(() => loadConfig({})).toThrow(/TP_ORIGIN.*TP_DB_PATH|TP_DB_PATH.*TP_ORIGIN/s);
  });

  test('rmpRefresh is on unless TP_RMP_REFRESH is the literal "off"', () => {
    expect(loadConfig(base).rmpRefresh).toBe(true);
    expect(loadConfig({ ...base, TP_RMP_REFRESH: 'on' }).rmpRefresh).toBe(true);
    expect(loadConfig({ ...base, TP_RMP_REFRESH: 'OFF' }).rmpRefresh).toBe(true);
    expect(loadConfig({ ...base, TP_RMP_REFRESH: 'off' }).rmpRefresh).toBe(false);
  });

  test('cookieSecure is only disabled by the literal "false"', () => {
    expect(loadConfig(base).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, TP_COOKIE_SECURE: '0' }).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, TP_COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
  });

  test('resend transport requires RESEND_API_KEY', () => {
    const env = { TP_ORIGIN: 'https://tritonplan.cn', TP_DB_PATH: 'x.db', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' };
    expect(() => loadConfig(env)).toThrow(/RESEND_API_KEY/);
    expect(loadConfig({ ...env, RESEND_API_KEY: 'k' }).mail.resendApiKey).toBe('k');
  });

  test('resend transport (production) also requires both Google secrets, non-empty', () => {
    const env = { TP_ORIGIN: 'https://tritonplan.cn', TP_DB_PATH: 'x.db', RESEND_API_KEY: 'k' };
    expect(() => loadConfig(env)).toThrow(/GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/s);
    expect(() => loadConfig({ ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: '' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => loadConfig({ ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).not.toThrow();
    const c = loadConfig({ ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' });
    expect([c.googleClientId, c.googleClientSecret]).toEqual(['id', 's']);
    // Local transports keep working without Google set up.
    expect(() => loadConfig(base)).not.toThrow();
  });

  test('defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ port: 8787, host: '127.0.0.1', googleClientId: '' });
    expect(c.mail.from).toBe('TritonPlan <noreply@tritonplan.cn>');
  });

  test('origin is normalized to a bare origin; an unparseable one is a config error', () => {
    expect(loadConfig({ ...base, TP_ORIGIN: 'https://tritonplan.cn/' }).origin).toBe('https://tritonplan.cn');
    expect(loadConfig({ ...base, TP_ORIGIN: 'http://localhost:5173/x?y' }).origin).toBe('http://localhost:5173');
    expect(() => loadConfig({ ...base, TP_ORIGIN: 'not a url' })).toThrow(/TP_ORIGIN/);
  });

  test('rejects an unknown mail transport and a bad port', () => {
    expect(() => loadConfig({ ...base, TP_MAIL_TRANSPORT: 'smtp' })).toThrow(/TP_MAIL_TRANSPORT/);
    expect(() => loadConfig({ ...base, TP_PORT: 'abc' })).toThrow(/TP_PORT/);
  });
});

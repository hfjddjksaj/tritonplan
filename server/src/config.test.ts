import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

const base = { TP_ORIGIN: 'http://localhost:5173', TP_DB_PATH: ':memory:', TP_MAIL_TRANSPORT: 'console' };

describe('loadConfig', () => {
  test('missing required vars are all named', () => {
    expect(() => loadConfig({})).toThrow(/TP_ORIGIN.*TP_DB_PATH|TP_DB_PATH.*TP_ORIGIN/s);
  });

  test('cookieSecure is only disabled by the literal "false"', () => {
    expect(loadConfig(base).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, TP_COOKIE_SECURE: '0' }).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, TP_COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
  });

  test('resend transport requires RESEND_API_KEY', () => {
    const env = { TP_ORIGIN: 'https://tritonplan.cn', TP_DB_PATH: 'x.db' };
    expect(() => loadConfig(env)).toThrow(/RESEND_API_KEY/);
    expect(loadConfig({ ...env, RESEND_API_KEY: 'k' }).mail.resendApiKey).toBe('k');
  });

  test('defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ port: 8787, host: '127.0.0.1', googleClientId: '' });
    expect(c.mail.from).toBe('TritonPlan <noreply@tritonplan.cn>');
  });

  test('rejects an unknown mail transport and a bad port', () => {
    expect(() => loadConfig({ ...base, TP_MAIL_TRANSPORT: 'smtp' })).toThrow(/TP_MAIL_TRANSPORT/);
    expect(() => loadConfig({ ...base, TP_PORT: 'abc' })).toThrow(/TP_PORT/);
  });
});

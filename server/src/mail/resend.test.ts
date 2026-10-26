import { expect, test } from 'vitest';
import { createResendMailer } from './resend';

test('resend mailer posts the documented payload and throws on failure', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  const m = createResendMailer('re_key', 'TritonPlan <noreply@tritonplan.cn>', fakeFetch);
  await m.send({ to: 'a@b.com', subject: 'S', text: 'T' });
  expect(calls[0]!.url).toBe('https://api.resend.com/emails');
  expect(calls[0]!.init.method).toBe('POST');
  const h = new Headers(calls[0]!.init.headers);
  expect(h.get('authorization')).toBe('Bearer re_key');
  expect(h.get('content-type')).toBe('application/json');
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ from: 'TritonPlan <noreply@tritonplan.cn>', to: ['a@b.com'], subject: 'S', text: 'T' });
  status = 422;
  await expect(m.send({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toThrow(/422/);
});

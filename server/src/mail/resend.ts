import type { Mailer } from './mailer';

export function createResendMailer(apiKey: string, from: string, fetchFn: typeof fetch): Mailer {
  return {
    async send(m) {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(10_000), // a hung upstream must not hold the request handler forever
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {}); // release the socket; never read the body
        // Status only: the response body can echo the recipient address, which must not reach logs.
        throw new Error(`Resend responded ${res.status}`);
      }
    },
  };
}

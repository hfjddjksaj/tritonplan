import type { Mailer } from './mailer';

export function createResendMailer(apiKey: string, from: string, fetchFn: typeof fetch): Mailer {
  return {
    async send(m) {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
      });
      // Status only: the response body can echo the recipient address, which must not reach logs.
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(m: MailMessage): Promise<void>;
}

/** Test double: records messages instead of sending. */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
    },
  };
}

/** Local dev: print the mail (verification links included) to stdout. */
export function createConsoleMailer(): Mailer {
  return {
    async send(m) {
      console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}`);
    },
  };
}

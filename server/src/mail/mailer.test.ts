import { expect, test, vi } from 'vitest';
import { createConsoleMailer, createMemoryMailer } from './mailer';

const msg = { to: 'a@b.c', subject: 's', text: 't' };

test('memory mailer records what was sent', async () => {
  const m = createMemoryMailer();
  await m.send(msg);
  expect(m.sent).toEqual([msg]);
});

test('console mailer prints recipient and body', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await createConsoleMailer().send(msg);
  expect(log.mock.calls[0]![0]).toContain('a@b.c');
  expect(log.mock.calls[0]![0]).toContain('t');
  log.mockRestore();
});

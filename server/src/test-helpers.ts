import type { Deps } from './app';
import { openDb } from './db/db';
import { createMemoryMailer } from './mail/mailer';

type TestDeps = Deps & { mailer: ReturnType<typeof createMemoryMailer> };

/** Fresh in-memory deps for route tests; override any field per test. */
export function testDeps(over: Partial<Deps> = {}): TestDeps {
  return {
    db: openDb(':memory:'),
    config: {
      port: 0,
      host: '127.0.0.1',
      origin: 'https://tritonplan.cn',
      dbPath: ':memory:',
      cookieSecure: true,
      googleClientId: 'test-google-id',
      googleClientSecret: 'test-google-secret',
      rmpRefresh: false,
      mail: { transport: 'memory', from: 'TritonPlan <noreply@tritonplan.cn>' },
    },
    mailer: createMemoryMailer(),
    now: () => new Date('2026-01-15T12:00:00.000Z'),
    fetch: () => Promise.reject(new Error('fetch not stubbed in this test')),
    ...over,
  } as TestDeps;
}

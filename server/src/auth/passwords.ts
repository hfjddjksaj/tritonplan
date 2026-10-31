import nodeCrypto, { randomBytes, timingSafeEqual } from 'node:crypto';

// OWASP argon2id minimum profile (19 MiB, 2 passes, 1 lane). Changing these needs a rehash-on-login path,
// because verifyPassword reads the parameters back out of each stored PHC string.
const MEMORY = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

type Argon2Params = { message: Buffer; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number };
// crypto.argon2 landed in Node 24; @types/node 22 does not declare it yet.
const argon2 = (nodeCrypto as unknown as {
  argon2: (alg: 'argon2id', p: Argon2Params, cb: (err: Error | null, key: Buffer) => void) => void;
}).argon2;

function derive(message: string, nonce: Buffer, memory: number, passes: number, parallelism: number, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: Buffer.from(message, 'utf8'), nonce, parallelism, tagLength, memory, passes }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(pw, salt, MEMORY, PASSES, PARALLELISM, TAG_LENGTH);
  return `$argon2id$v=19$m=${MEMORY},t=${PASSES},p=${PARALLELISM}$${b64(salt)}$${b64(hash)}`;
}

// PHC strings use unpadded base64.
const b64 = (b: Buffer): string => b.toString('base64').replace(/=+$/, '');

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(pw: string, phc: string): Promise<boolean> {
  try {
    const m = PHC.exec(phc);
    if (!m) return false;
    const memory = Number(m[1]);
    const passes = Number(m[2]);
    const parallelism = Number(m[3]);
    const salt = Buffer.from(m[4]!, 'base64');
    const expected = Buffer.from(m[5]!, 'base64');
    // Pin to our one profile: a corrupted or planted row must never choose its own derivation cost.
    if (memory !== MEMORY || passes !== PASSES || parallelism !== PARALLELISM) return false;
    if (salt.length !== SALT_LENGTH || expected.length !== TAG_LENGTH) return false;
    const actual = await derive(pw, salt, MEMORY, PASSES, PARALLELISM, TAG_LENGTH);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** crypto.argon2 arrived in Node 24.7; on older 24.x every login would silently read as "wrong password". */
export function assertArgon2Available(): void {
  if (typeof argon2 !== 'function') {
    throw new Error('crypto.argon2 is unavailable: TritonPlan server needs Node >= 24.7');
  }
}

export function passwordProblem(pw: string): 'too-short' | 'too-long' | null {
  if (pw.length < 8) return 'too-short';
  if (pw.length > 200) return 'too-long';
  return null;
}

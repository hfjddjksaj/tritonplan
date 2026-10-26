import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

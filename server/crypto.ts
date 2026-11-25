import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomHex = (bytes: number) => randomBytes(bytes).toString('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Canonical JSON: sorted keys, so signatures are reproducible. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

function privateKey() {
  return createPrivateKey({ key: Buffer.from(env.presenceKey, 'base64'), format: 'der', type: 'pkcs8' });
}

export function signRecord(record: unknown): string {
  return sign(null, Buffer.from(canonical(record)), privateKey()).toString('base64');
}

export function publicKeyBase64(): string {
  return createPublicKey(privateKey()).export({ format: 'der', type: 'spki' }).toString('base64');
}

export function verifyRecord(record: unknown, signature: string, publicKeySpkiB64 = publicKeyBase64()): boolean {
  const pub = createPublicKey({ key: Buffer.from(publicKeySpkiB64, 'base64'), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(canonical(record)), pub, Buffer.from(signature, 'base64'));
}

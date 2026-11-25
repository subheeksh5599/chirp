// Rotating broadcast codes: code(slot) = base32(HMAC-SHA256(key, "chirp:" + slot))[0..8)
// A slot is 5 seconds. Only the server (and the console it hands codes to) can produce them.
import { encodeBits } from './base32.js';
import { CODE_CHARS } from './frame.js';

export const SLOT_MS = 5000;

export const slotOf = (ms: number) => Math.floor(ms / SLOT_MS);

async function hmacKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function codeForSlot(key: Uint8Array, slot: number): Promise<string> {
  const k = await hmacKey(key);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`chirp:${slot}`)));
  return encodeBits(mac, CODE_CHARS);
}

/**
 * Which slot (if any) a heard code belongs to, allowing ±tolerance slots of clock drift
 * and the time a chirp spends in the air.
 */
export async function matchSlot(
  key: Uint8Array,
  code: string,
  nowMs: number,
  tolerance = 1,
): Promise<number | null> {
  const now = slotOf(nowMs);
  for (let d = 0; d <= tolerance; d++) {
    for (const s of d === 0 ? [now] : [now - d, now + d]) {
      if ((await codeForSlot(key, s)) === code) return s;
    }
  }
  return null;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

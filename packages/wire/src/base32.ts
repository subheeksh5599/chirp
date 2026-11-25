// Crockford base32: no I, L, O, U, so codes read and decode cleanly.
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Encode the first `chars * 5` bits of `bytes` as base32 characters. */
export function encodeBits(bytes: Uint8Array, chars: number): string {
  if (chars * 5 > bytes.length * 8) throw new Error('not enough bytes for requested length');
  let out = '';
  let acc = 0;
  let bits = 0;
  let i = 0;
  while (out.length < chars) {
    if (bits < 5) {
      acc = (acc << 8) | bytes[i++];
      bits += 8;
    }
    bits -= 5;
    out += ALPHABET[(acc >> bits) & 31];
  }
  return out;
}

export function isCode(s: string, chars: number): boolean {
  if (s.length !== chars) return false;
  for (const c of s) if (!ALPHABET.includes(c)) return false;
  return true;
}

/** Random code of `chars` base32 characters (5 bits each) from a CSPRNG. */
export function randomCode(chars = 8): string {
  const bytes = new Uint8Array(Math.ceil((chars * 5) / 8));
  crypto.getRandomValues(bytes);
  return encodeBits(bytes, chars);
}

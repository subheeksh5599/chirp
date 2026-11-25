// A Chirp frame is 9 ASCII characters carried by the sound codec:
//   [type][code × 8]
// The codec adds its own Reed-Solomon error correction, so the frame carries no CRC.
import { isCode } from './base32.js';

export const CODE_CHARS = 8;

export const FrameType = {
  /** Broadcast / presence: rotating session code. */
  Broadcast: 'B',
  /** Hand-off: one-off token (contact card, bill). */
  Handoff: 'H',
  /** Sync: a stream marker token. */
  Sync: 'S',
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export type Frame = { type: FrameType; code: string };

const TYPES = new Set<string>(Object.values(FrameType));

export function encodeFrame(f: Frame): string {
  if (!TYPES.has(f.type)) throw new Error(`unknown frame type ${f.type}`);
  if (!isCode(f.code, CODE_CHARS)) throw new Error('code must be 8 base32 characters');
  return f.type + f.code;
}

/** Parse decoded text; returns null for anything that isn't a valid frame. */
export function parseFrame(text: string): Frame | null {
  const s = text.trim().toUpperCase();
  if (s.length !== 1 + CODE_CHARS) return null;
  const type = s[0];
  const code = s.slice(1);
  if (!TYPES.has(type) || !isCode(code, CODE_CHARS)) return null;
  return { type: type as FrameType, code };
}

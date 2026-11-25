import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  CODE_CHARS,
  DEFAULT_RULE,
  FrameType,
  SLOT_MS,
  bytesToHex,
  codeForSlot,
  encodeBits,
  encodeFrame,
  evaluatePresence,
  hexToBytes,
  isCode,
  matchSlot,
  parseFrame,
  randomCode,
  slotOf,
} from '../src/index.js';

const KEY = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

describe('base32', () => {
  it('encodes known bits', () => {
    expect(encodeBits(new Uint8Array([0, 0, 0, 0, 0]), 8)).toBe('00000000');
    expect(encodeBits(new Uint8Array([255, 255, 255, 255, 255]), 8)).toBe('ZZZZZZZZ');
    // 0b00001 00010 00011 ... → 1,2,3,...
    expect(encodeBits(new Uint8Array([0x08, 0x86, 0x42, 0x98, 0xe8]), 8)).toBe('12345678');
  });
  it('rejects too few bytes', () => {
    expect(() => encodeBits(new Uint8Array(2), 8)).toThrow();
  });
  it('alphabet has no ambiguous letters', () => {
    expect(ALPHABET).toHaveLength(32);
    for (const c of 'ILOU') expect(ALPHABET).not.toContain(c);
  });
  it('random codes are valid and differ', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect(isCode(c, 8)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
  });
  it('isCode checks length and alphabet', () => {
    expect(isCode('ABCDEFGH', 8)).toBe(true);
    expect(isCode('ABCDEFG', 8)).toBe(false);
    expect(isCode('ABCDEFGI', 8)).toBe(false);
  });
});

describe('frame', () => {
  it('round-trips every type', () => {
    for (const type of Object.values(FrameType)) {
      const code = randomCode();
      const text = encodeFrame({ type, code });
      expect(text).toHaveLength(1 + CODE_CHARS);
      expect(parseFrame(text)).toEqual({ type, code });
    }
  });
  it('tolerates whitespace and lowercase from the decoder', () => {
    expect(parseFrame(' babcdefgh\n')).toEqual({ type: 'B', code: 'ABCDEFGH' });
  });
  it('rejects unknown types, bad length and bad characters', () => {
    expect(parseFrame('XABCDEFGH')).toBeNull();
    expect(parseFrame('BABCDEFG')).toBeNull();
    expect(parseFrame('BABCDEFGHJ')).toBeNull();
    expect(parseFrame('BABCDEFGI')).toBeNull();
    expect(parseFrame('')).toBeNull();
  });
  it('refuses to encode invalid frames', () => {
    expect(() => encodeFrame({ type: 'Q' as never, code: 'ABCDEFGH' })).toThrow();
    expect(() => encodeFrame({ type: 'B', code: 'abc' })).toThrow();
  });
});

describe('rotating codes', () => {
  it('slots are 5 seconds', () => {
    expect(SLOT_MS).toBe(5000);
    expect(slotOf(0)).toBe(0);
    expect(slotOf(4999)).toBe(0);
    expect(slotOf(5000)).toBe(1);
  });
  it('is deterministic per key and slot (test vector)', async () => {
    const a = await codeForSlot(KEY, 123456);
    expect(a).toBe(await codeForSlot(KEY, 123456));
    expect(isCode(a, 8)).toBe(true);
    expect(a).not.toBe(await codeForSlot(KEY, 123457));
    const other = hexToBytes('ff'.repeat(32));
    expect(a).not.toBe(await codeForSlot(other, 123456));
  });
  it('matches the current slot and ±1, but not ±2', async () => {
    const now = 1_800_000_000_000;
    const s = slotOf(now);
    expect(await matchSlot(KEY, await codeForSlot(KEY, s), now)).toBe(s);
    expect(await matchSlot(KEY, await codeForSlot(KEY, s - 1), now)).toBe(s - 1);
    expect(await matchSlot(KEY, await codeForSlot(KEY, s + 1), now)).toBe(s + 1);
    expect(await matchSlot(KEY, await codeForSlot(KEY, s - 2), now)).toBeNull();
    expect(await matchSlot(KEY, await codeForSlot(KEY, s - 720), now)).toBeNull(); // an hour-old recording
  });
  it('rejects a code made with the wrong key', async () => {
    const now = 1_800_000_000_000;
    const forged = await codeForSlot(hexToBytes('11'.repeat(32)), slotOf(now));
    expect(await matchSlot(KEY, forged, now)).toBeNull();
  });
  it('hex helpers round-trip and validate', () => {
    expect(bytesToHex(hexToBytes('00ff10'))).toBe('00ff10');
    expect(() => hexToBytes('abc')).toThrow();
    expect(() => hexToBytes('zz')).toThrow();
  });
});

describe('presence rule', () => {
  const perMinute = 60_000 / SLOT_MS; // 12 slots per minute
  it('one shared code never qualifies', () => {
    const r = evaluatePresence([1000]);
    expect(r.ok).toBe(false);
    expect(r.codes).toBe(1);
  });
  it('three codes inside two minutes do not qualify', () => {
    const r = evaluatePresence([0, perMinute, perMinute * 2]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/minutes/);
  });
  it('three codes spread over ten minutes qualify', () => {
    const r = evaluatePresence([0, perMinute * 5, perMinute * 10]);
    expect(r).toMatchObject({ ok: true, codes: 3 });
    expect(r.spanMinutes).toBe(10);
  });
  it('duplicate slots are counted once', () => {
    expect(evaluatePresence([5, 5, 5, 5]).codes).toBe(1);
  });
  it('organisers can set a stricter or shorter rule', () => {
    const slots = [0, perMinute, perMinute * 2];
    expect(evaluatePresence(slots, { minCodes: 3, minMinutes: 2 }).ok).toBe(true);
    expect(evaluatePresence(slots, { minCodes: 4, minMinutes: 2 }).ok).toBe(false);
    expect(DEFAULT_RULE).toEqual({ minCodes: 3, minMinutes: 10 });
  });
});

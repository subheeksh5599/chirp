// Property tests: many random inputs per rule, deterministic seed so failures repeat.
import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  CODE_CHARS,
  DEFAULT_RULE,
  SLOT_MS,
  codeForSlot,
  encodeFrame,
  evaluatePresence,
  isCode,
  matchSlot,
  parseFrame,
  randomCode,
} from '../src/index.js';

let seed = 0x5eed;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const key = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * 31 + n) & 255);

describe('frames, for any valid code', () => {
  it('encode → parse round-trips for 500 random codes and every type', () => {
    for (let i = 0; i < 500; i++) {
      const code = randomCode(CODE_CHARS);
      const type = pick(['B', 'H', 'S'] as const);
      expect(parseFrame(encodeFrame({ type, code }))).toEqual({ type, code });
    }
  });
  it('parsing tolerates lower case and surrounding whitespace', () => {
    for (let i = 0; i < 100; i++) {
      const f = encodeFrame({ type: 'H', code: randomCode() });
      expect(parseFrame(`  ${f.toLowerCase()}\n`)).toEqual(parseFrame(f));
    }
  });
  it('any single character changed to a non-alphabet character is rejected', () => {
    const bad = 'ILOU!@ -_';
    for (let i = 0; i < 300; i++) {
      const f = encodeFrame({ type: 'B', code: randomCode() });
      const at = 1 + Math.floor(rand() * CODE_CHARS);
      const mutated = f.slice(0, at) + pick([...bad]) + f.slice(at + 1);
      expect(parseFrame(mutated)).toBeNull();
    }
  });
  it('wrong length is always rejected', () => {
    for (let n = 0; n < 20; n++) {
      if (n === 1 + CODE_CHARS) continue;
      expect(parseFrame('B'.repeat(n))).toBeNull();
    }
  });
  it('unknown types are rejected for every letter outside B, H, S', () => {
    for (const t of 'ACDEFGJKMNPQRTVWXYZ0123456789') expect(parseFrame(t + randomCode())).toBeNull();
  });
  it('random codes only use the alphabet and are unique across 5,000 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const c = randomCode();
      expect(isCode(c, CODE_CHARS)).toBe(true);
      for (const ch of c) expect(ALPHABET).toContain(ch);
      seen.add(c);
    }
    expect(seen.size).toBe(5000);
  });
});

describe('rotating room codes', () => {
  it('are deterministic per key and slot', async () => {
    for (let s = 0; s < 50; s++) expect(await codeForSlot(key(1), s)).toBe(await codeForSlot(key(1), s));
  });
  it('differ between neighbouring slots and between rooms', async () => {
    const a = new Set<string>();
    for (let s = 1000; s < 1200; s++) a.add(await codeForSlot(key(1), s));
    expect(a.size).toBe(200);
    for (let s = 1000; s < 1050; s++) expect(await codeForSlot(key(1), s)).not.toBe(await codeForSlot(key(2), s));
  });
  it('match at any time inside the slot, and never two slots away', async () => {
    for (let i = 0; i < 40; i++) {
      const slot = 300_000_000 + Math.floor(rand() * 1e6);
      const code = await codeForSlot(key(3), slot);
      const inside = slot * SLOT_MS + Math.floor(rand() * SLOT_MS);
      expect(await matchSlot(key(3), code, inside)).toBe(slot);
      expect(await matchSlot(key(3), code, inside + 2 * SLOT_MS)).toBeNull();
      expect(await matchSlot(key(3), code, inside - 2 * SLOT_MS)).toBeNull();
    }
  });
});

describe('presence rule, for any set of hearings', () => {
  it('never qualifies with fewer distinct codes than the rule asks, however spread', () => {
    for (let i = 0; i < 300; i++) {
      const n = Math.floor(rand() * DEFAULT_RULE.minCodes);
      const slots = Array.from({ length: n }, () => Math.floor(rand() * 10_000));
      expect(evaluatePresence(slots).ok).toBe(false);
    }
  });
  it('the same code heard many times counts once', () => {
    for (let i = 0; i < 100; i++) {
      const s = Math.floor(rand() * 1e6);
      const r = evaluatePresence(Array(1 + Math.floor(rand() * 200)).fill(s));
      expect(r.codes).toBe(1);
      expect(r.ok).toBe(false);
    }
  });
  it('qualifies exactly when codes ≥ minCodes and span ≥ minMinutes', () => {
    const perMin = 60_000 / SLOT_MS;
    for (let i = 0; i < 400; i++) {
      const n = 1 + Math.floor(rand() * 8);
      const start = Math.floor(rand() * 1e6);
      const slots = Array.from({ length: n }, () => start + Math.floor(rand() * 20 * perMin));
      const uniq = [...new Set(slots)].sort((a, b) => a - b);
      const span = uniq.length < 2 ? 0 : ((uniq.at(-1)! - uniq[0]) * SLOT_MS) / 60_000;
      const expected = uniq.length >= DEFAULT_RULE.minCodes && span >= DEFAULT_RULE.minMinutes;
      expect(evaluatePresence(slots).ok).toBe(expected);
    }
  });
  it('order of hearings does not matter', () => {
    for (let i = 0; i < 100; i++) {
      const slots = Array.from({ length: 6 }, () => Math.floor(rand() * 500));
      const shuffled = [...slots].sort(() => rand() - 0.5);
      expect(evaluatePresence(shuffled)).toEqual(evaluatePresence(slots));
    }
  });
});

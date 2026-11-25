// Shape properties of the soft chirp, independent of the codec.
import { describe, expect, it } from 'vitest';
import { SOFT_DEFAULTS, dbfs, soften } from '../src/index.js';

const RATE = 48000;
const tone = (hz: number, s: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(RATE * s) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

describe('soften', () => {
  it('starts and ends at silence (no click)', () => {
    const y = soften(tone(3000, 0.5), RATE);
    expect(Math.abs(y[0])).toBeLessThan(1e-3);
    expect(Math.abs(y[y.length - 1])).toBeLessThan(1e-3);
  });
  it('never gets louder than the input', () => {
    for (const hz of [500, 2000, 4000, 6000]) {
      const x = tone(hz, 0.3);
      expect(dbfs(soften(x, RATE))).toBeLessThanOrEqual(dbfs(x) + 0.1);
    }
  });
  it('keeps the chirp band and cuts harsh high tones', () => {
    const inBand = dbfs(soften(tone(3000, 0.4), RATE)) - dbfs(tone(3000, 0.4));
    const harsh = dbfs(soften(tone(14000, 0.4), RATE)) - dbfs(tone(14000, 0.4));
    expect(inBand).toBeGreaterThan(-4);
    expect(harsh).toBeLessThan(inBand - 6);
  });
  it('repeat=2 is two copies plus the gap', () => {
    const x = tone(3000, 0.2);
    const one = soften(x, RATE).length;
    const two = soften(x, RATE, { repeat: 2 }).length;
    expect(two).toBe(2 * one + Math.round((RATE * SOFT_DEFAULTS.gapMs) / 1000));
  });
  it('the gap between copies is silent', () => {
    const x = tone(3000, 0.2);
    const one = soften(x, RATE).length;
    const y = soften(x, RATE, { repeat: 2 });
    const gap = y.subarray(one + 10, one + Math.round((RATE * SOFT_DEFAULTS.gapMs) / 1000) - 10);
    expect(Math.max(...Array.from(gap, Math.abs))).toBeLessThan(1e-3);
  });
  it('does not modify the caller’s buffer', () => {
    const x = tone(2500, 0.1);
    const copy = x.slice();
    soften(x, RATE, { repeat: 2 });
    expect(x).toEqual(copy);
  });
  it('dbfs of full-scale sine is about -3 dB, silence is -Infinity or very low', () => {
    expect(dbfs(tone(1000, 0.2, 1))).toBeCloseTo(-3.01, 1);
    expect(dbfs(new Float32Array(1000))).toBeLessThan(-100);
  });
});

import { describe, expect, it } from 'vitest';
import { envelope } from '../src/chirp';

describe('waveform envelope', () => {
  it('returns one value per bucket, scaled so the loudest is 1', () => {
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i / 3) * (i < 4800 ? 0.2 : 0.5));
    const env = envelope(x, 96);
    expect(env).toHaveLength(96);
    expect(Math.max(...env)).toBe(1);
    expect(env[10]).toBeCloseTo(0.4, 1);
  });
  it('shows silence as zero, so the gap between two copies is visible', () => {
    const x = new Float32Array(4800);
    x.fill(0.3, 0, 1600);
    x.fill(0.3, 3200);
    const env = envelope(x, 3);
    expect(env).toEqual([1, 0, 1]);
  });
  it('an all-silent buffer does not divide by zero', () => {
    expect(envelope(new Float32Array(100), 4)).toEqual([0, 0, 0, 0]);
  });
});

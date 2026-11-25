import { describe, expect, it } from 'vitest';
import { Dedupe, SAME_CHIRP_MS } from '../src/decoder';

describe('same-chirp filter', () => {
  it('drops the second copy of one press (about 2 s later)', () => {
    const d = new Dedupe();
    expect(d.accept('HTEST0000', 0)).toBe(true);
    expect(d.accept('HTEST0000', 1_900)).toBe(false);
  });

  it('accepts every press of the same code, even pressed every 5 s', () => {
    const d = new Dedupe();
    for (let i = 0; i < 10; i++) {
      const t = i * 5_000;
      expect(d.accept('HTEST0000', t), `press ${i + 1}`).toBe(true);
      expect(d.accept('HTEST0000', t + 1_900), `echo of press ${i + 1}`).toBe(false);
    }
  });

  it('a different code is never dropped, however soon', () => {
    const d = new Dedupe();
    expect(d.accept('HAAAAAAAA', 0)).toBe(true);
    expect(d.accept('HBBBBBBBB', 100)).toBe(true);
    expect(d.accept('HAAAAAAAA', 200)).toBe(true);
  });

  it('the window is just longer than one press with two copies', () => {
    expect(SAME_CHIRP_MS).toBeGreaterThan(2_000);
    expect(SAME_CHIRP_MS).toBeLessThan(5_000);
  });
});

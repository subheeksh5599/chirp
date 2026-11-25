import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { dbfs, soften } from '../src/index.js';
import { encodeFrame, parseFrame, randomCode } from '../../wire/src/index.js';

const require = createRequire(import.meta.url);
type GG = {
  getDefaultParameters(): Record<string, number>;
  init(p: Record<string, number>): number;
  encode(i: number, s: string, proto: number, vol: number): Int8Array;
  decode(i: number, d: Int8Array): Uint8Array | null;
  free(i: number): void;
  ProtocolId: Record<string, number>;
};
const gg: GG = await (require('ggwave') as () => Promise<GG>)();
const asF32 = (i8: Int8Array) => new Float32Array(i8.buffer, i8.byteOffset, i8.byteLength / 4).slice();

function tx(text: string): Float32Array {
  const p = gg.getDefaultParameters();
  p.sampleRateInp = 48000;
  p.sampleRateOut = 48000;
  const inst = gg.init(p);
  const w = asF32(gg.encode(inst, text, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, 12));
  gg.free(inst);
  return w;
}

// 48 kHz -> 16 kHz the way a 16 kHz mic sees it (simple average of 3, then int16).
function toMic16(x: Float32Array): Float32Array {
  const y = new Float32Array(Math.floor(x.length / 3));
  for (let i = 0; i < y.length; i++) y[i] = Math.round(((x[i * 3] + x[i * 3 + 1] + x[i * 3 + 2]) / 3) * 32767) / 32768;
  return y;
}

function rx16(x: Float32Array): string | null {
  const p = gg.getDefaultParameters();
  p.sampleRateInp = 16000;
  p.sampleRateOut = 16000;
  const inst = gg.init(p);
  const padded = new Float32Array(x.length + 16000);
  padded.set(x, 8000);
  let got: string | null = null;
  for (let i = 0; i < padded.length && !got; i += 1600) {
    const r = gg.decode(inst, new Int8Array(padded.slice(i, i + 1600).buffer));
    if (r && r.length) got = new TextDecoder().decode(r);
  }
  gg.free(inst);
  return got;
}

describe('soften', () => {
  it('starts and ends in silence (no clicks)', () => {
    const w = soften(tx('BABCDEFGH'), 48000);
    expect(Math.abs(w[0])).toBeLessThan(1e-4);
    expect(Math.abs(w[w.length - 1])).toBeLessThan(1e-4);
  });
  it('repeat=2 is two copies plus the gap', () => {
    const raw = tx('BABCDEFGH');
    const one = soften(raw, 48000);
    const two = soften(raw, 48000, { repeat: 2, gapMs: 250 });
    expect(two.length).toBe(one.length * 2 + 12000);
  });
  it('is not louder than the raw codec output', () => {
    const raw = tx('BABCDEFGH');
    expect(dbfs(soften(raw, 48000))).toBeLessThanOrEqual(dbfs(raw) + 0.1);
  });
});

describe('soft chirp survives the 16 kHz mic path', () => {
  it('decodes real frames after softening and downsampling', () => {
    let ok = 0;
    const N = 8;
    for (let i = 0; i < N; i++) {
      const frame = encodeFrame({ type: 'H', code: randomCode() });
      const got = rx16(toMic16(soften(tx(frame), 48000)));
      if (got && parseFrame(got)?.code === frame.slice(1)) ok++;
    }
    expect(ok).toBe(N);
  });
});

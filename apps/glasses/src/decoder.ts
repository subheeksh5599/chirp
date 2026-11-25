// Turns 16 kHz signed-16-bit PCM chunks from the mic into decoded Chirp payloads.
import ggwaveFactory from 'ggwave';

export type Decoded = { text: string; at: number };

/**
 * One press plays two copies about 2 s apart; both can decode. This keeps the first and drops the
 * echo, and nothing longer: a second press of the same code a few seconds later is a new chirp.
 */
export const SAME_CHIRP_MS = 4_000;

export class Dedupe {
  private lastText = '';
  private lastAt = -Infinity;
  constructor(private windowMs = SAME_CHIRP_MS) {}
  /** True when this text is new, or the same text heard after the window. */
  accept(text: string, at: number): boolean {
    if (text === this.lastText && at - this.lastAt < this.windowMs) return false;
    this.lastText = text;
    this.lastAt = at;
    return true;
  }
}

type GG = {
  getDefaultParameters(): Record<string, number>;
  init(p: Record<string, number>): number;
  decode(inst: number, data: Int8Array): Uint8Array | null;
  free(inst: number): void;
};

export class ChirpDecoder {
  private gg!: GG;
  private inst = -1;
  private dedupe = new Dedupe();
  // Stats feed the on-lens debug line and the field measurements.
  chunks = 0;
  peak = 0;

  async init(): Promise<void> {
    this.gg = (await (ggwaveFactory as unknown as () => Promise<GG>)()) as GG;
    const p = this.gg.getDefaultParameters();
    p.sampleRateInp = 16000;
    p.sampleRateOut = 16000;
    this.inst = this.gg.init(p);
  }

  /** Feed one audio event. Returns a payload when a full chirp has been decoded. */
  push(pcm: Uint8Array): Decoded | null {
    const n = pcm.byteLength >> 1;
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const f = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = view.getInt16(i * 2, true) / 32768;
      f[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    this.chunks++;
    this.peak = peak;
    const res = this.gg.decode(this.inst, new Int8Array(f.buffer));
    if (!res || res.length === 0) return null;
    const text = new TextDecoder().decode(res);
    const at = Date.now();
    return this.dedupe.accept(text, at) ? { text, at } : null;
  }
}

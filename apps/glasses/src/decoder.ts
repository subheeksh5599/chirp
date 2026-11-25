// Turns 16 kHz signed-16-bit PCM chunks from the mic into decoded Chirp payloads.
import ggwaveFactory from 'ggwave';

export type Decoded = { text: string; at: number };

type GG = {
  getDefaultParameters(): Record<string, number>;
  init(p: Record<string, number>): number;
  decode(inst: number, data: Int8Array): Uint8Array | null;
  free(inst: number): void;
};

export class ChirpDecoder {
  private gg!: GG;
  private inst = -1;
  private lastText = '';
  private lastAt = 0;
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
    // The same chirp heard twice within 10 s counts once.
    if (text === this.lastText && at - this.lastAt < 10_000) return null;
    this.lastText = text;
    this.lastAt = at;
    return { text, at };
  }
}

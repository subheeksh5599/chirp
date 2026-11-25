// Shared by every sender page: play a Chirp frame as a soft sound, and call the API.
import ggwaveFactory from 'ggwave';
import { soften } from '@chirp/sound';

type GG = {
  getDefaultParameters(): Record<string, number>;
  init(p: Record<string, number>): number;
  encode(inst: number, payload: string, protocol: number, volume: number): Int8Array;
  ProtocolId: Record<string, number>;
};

let gg: GG | null = null;
let inst = -1;
let ctx: AudioContext | null = null;

/** Volume 1–100 fed to the codec before softening. 12 measured reliable and gentle. */
export const DEFAULT_VOLUME = 12;

async function ready(): Promise<AudioContext> {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  if (!gg) {
    gg = (await (ggwaveFactory as unknown as () => Promise<GG>)()) as GG;
    const p = gg.getDefaultParameters();
    p.sampleRateInp = ctx.sampleRate;
    p.sampleRateOut = ctx.sampleRate;
    inst = gg.init(p);
  }
  return ctx;
}

/** Render a frame to samples (also used to export a WAV for mixing into a stream). */
export async function renderFrame(frame: string, opts: { repeat?: number; volume?: number } = {}) {
  const c = await ready();
  const raw = gg!.encode(inst, frame, gg!.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, opts.volume ?? DEFAULT_VOLUME);
  const samples = soften(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(), c.sampleRate, {
    repeat: opts.repeat ?? 2,
  });
  return { samples, rate: c.sampleRate };
}

/** Play a frame now. Resolves when the sound has finished. */
export async function playFrame(frame: string, opts: { repeat?: number; volume?: number } = {}) {
  const c = await ready();
  const { samples } = await renderFrame(frame, opts);
  const buf = c.createBuffer(1, samples.length, c.sampleRate);
  buf.getChannelData(0).set(samples);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  const done = new Promise<void>((r) => (src.onended = () => r()));
  src.start();
  await done;
  return samples.length / c.sampleRate;
}

export function wavBlob(samples: Float32Array, rate: number): Blob {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true);
  b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data');
  b.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true));
  return new Blob([b.buffer], { type: 'audio/wav' });
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const r = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new ApiError(r.status, j.error ?? `request failed (${r.status})`);
  return j as T;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function status(el: HTMLElement, text: string, kind: 'ok' | 'err' | '' = '') {
  el.textContent = text;
  el.dataset.kind = kind;
}

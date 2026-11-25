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

/** Volume 1 to 100 fed to the codec before softening. 12 measured reliable and gentle. */
export const DEFAULT_VOLUME = 12;

/** The page's audio context. Creating it needs no user gesture; playing through it does. */
const audio = () => (ctx ??= new AudioContext());

/** Load the codec at the context's sample rate. Needs no speaker, so WAV export works anywhere. */
async function codec(): Promise<GG> {
  if (!gg) {
    gg = (await (ggwaveFactory as unknown as () => Promise<GG>)()) as GG;
    const p = gg.getDefaultParameters();
    p.sampleRateInp = audio().sampleRate;
    p.sampleRateOut = audio().sampleRate;
    inst = gg.init(p);
  }
  return gg;
}

/** Render a frame to samples (also used to export a WAV for mixing into a stream). */
export async function renderFrame(frame: string, opts: { repeat?: number; volume?: number } = {}) {
  const g = await codec();
  const rate = audio().sampleRate;
  const raw = g.encode(inst, frame, g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, opts.volume ?? DEFAULT_VOLUME);
  const samples = soften(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(), rate, {
    repeat: opts.repeat ?? 2,
  });
  return { samples, rate };
}

/** Play a frame now. Resolves when the sound has finished. Draws it on the page's `canvas.wave`, if any. */
export async function playFrame(
  frame: string,
  opts: { repeat?: number; volume?: number; wave?: HTMLCanvasElement | null } = {},
) {
  const { samples } = await renderFrame(frame, opts);
  const c = audio();
  if (c.state === 'suspended') await c.resume();
  const buf = c.createBuffer(1, samples.length, c.sampleRate);
  buf.getChannelData(0).set(samples);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  const done = new Promise<void>((r) => (src.onended = () => r()));
  const canvas = opts.wave === undefined ? document.querySelector<HTMLCanvasElement>('canvas.wave') : opts.wave;
  const startedAt = c.currentTime;
  src.start();
  const secs = samples.length / c.sampleRate;
  if (canvas) traceWave(canvas, envelope(samples, 96), () => (c.currentTime - startedAt) / secs, done);
  await done;
  return secs;
}

/** Peak level per bucket, normalised to the loudest bucket: the chirp's real shape. */
export function envelope(samples: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const peaks = Array.from({ length: buckets }, (_, b) => {
    let peak = 0;
    for (let i = b * size, end = Math.min(samples.length, i + size); i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
    return peak;
  });
  const top = Math.max(...peaks) || 1;
  return peaks.map((p) => p / top);
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function drawWave(canvas: HTMLCanvasElement, env: number[], progress: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const step = w / env.length;
  const bar = Math.max(1, step * 0.55);
  const played = cssVar('--accent');
  const rest = cssVar('--text-3');
  env.forEach((v, i) => {
    const bh = Math.max(2, v * (h - 4));
    g.fillStyle = i / env.length <= progress ? played : rest;
    g.fillRect(i * step, (h - bh) / 2, bar, bh);
  });
}

function traceWave(canvas: HTMLCanvasElement, env: number[], progress: () => number, done: Promise<void>) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    drawWave(canvas, env, 1);
    return;
  }
  let finished = false;
  void done.then(() => (finished = true));
  const tick = () => {
    drawWave(canvas, env, finished ? 1 : Math.min(1, progress()));
    if (!finished) requestAnimationFrame(tick);
  };
  tick();
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

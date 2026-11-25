import ggwaveFactory from 'ggwave';

type GG = {
  getDefaultParameters(): Record<string, number>;
  init(p: Record<string, number>): number;
  encode(inst: number, payload: string, protocol: number, volume: number): Int8Array;
  ProtocolId: Record<string, number>;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (msg: string) => {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} · ${msg}`;
  $('log').prepend(line);
};

let gg: GG | null = null;
let inst = -1;
let ctx: AudioContext | null = null;
let timer: number | undefined;

async function ready() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  if (!gg) {
    gg = (await (ggwaveFactory as unknown as () => Promise<GG>)()) as GG;
    const p = gg.getDefaultParameters();
    p.sampleRateInp = ctx.sampleRate;
    p.sampleRateOut = ctx.sampleRate;
    inst = gg.init(p);
  }
}

async function chirp() {
  await ready();
  const payload = $<HTMLInputElement>('payload').value.trim();
  if (!payload) return log('Enter a payload first.');
  const protocol = gg!.ProtocolId[$<HTMLSelectElement>('protocol').value];
  const volume = Number($<HTMLInputElement>('volume').value) || 40;
  const raw = gg!.encode(inst, payload, protocol, volume);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const buf = ctx!.createBuffer(1, samples.length, ctx!.sampleRate);
  buf.getChannelData(0).set(samples);
  const src = ctx!.createBufferSource();
  src.buffer = buf;
  src.connect(ctx!.destination);
  src.start();
  log(`chirped "${payload}" (${(samples.length / ctx!.sampleRate).toFixed(2)} s)`);
}

$('play').addEventListener('click', () => void chirp());
$('repeat').addEventListener('click', () => {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
    $('repeat').textContent = 'Chirp every 5 s';
    return;
  }
  void chirp();
  timer = window.setInterval(() => void chirp(), 5000);
  $('repeat').textContent = 'Stop repeating';
});

// Offline analysis of a raw mic capture (16 kHz s16le mono) from the simulator harness.
// Decodes the whole stream the way the app does, then re-tries each loud segment alone,
// and reports level and clipping per segment so misses can be explained.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const factory = require('ggwave');
const file = process.argv[2] ?? new URL('../.artifacts/capture.pcm', import.meta.url).pathname;
const buf = readFileSync(file);
const n = buf.length >> 1;
const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
console.log(`capture: ${(n / 16000).toFixed(1)} s`);

const gg = await factory();
const p = gg.getDefaultParameters();
p.sampleRateInp = 16000;
p.sampleRateOut = 16000;
const i8 = (f) => new Int8Array(f.buffer, f.byteOffset, f.byteLength);

function decodeStream(sig, chunk = 1600) {
  const inst = gg.init(p);
  const out = [];
  for (let i = 0; i < sig.length; i += chunk) {
    const r = gg.decode(inst, i8(sig.slice(i, i + chunk)));
    if (r && r.length) out.push({ t: (i / 16000).toFixed(1), text: new TextDecoder().decode(r) });
  }
  gg.free(inst);
  return out;
}

console.log('stream decode (100 ms chunks):', decodeStream(x).map((d) => `${d.t}s ${d.text}`).join(' | ') || 'none');

// Find loud segments (chirps) by 50 ms RMS.
const win = 800;
const rms = [];
for (let i = 0; i + win <= n; i += win) {
  let e = 0;
  for (let k = 0; k < win; k++) e += x[i + k] ** 2;
  rms.push(Math.sqrt(e / win));
}
const sorted = [...rms].sort((a, b) => a - b);
const floor = sorted[Math.floor(sorted.length * 0.2)];
const thr = Math.max(floor * 6, 0.003);
const segs = [];
let start = -1;
rms.forEach((v, j) => {
  if (v > thr && start < 0) start = j;
  if ((v <= thr || j === rms.length - 1) && start >= 0) {
    if (j - start >= 10) segs.push([start, j]);
    start = -1;
  }
});
console.log(`noise floor rms ${floor.toFixed(4)}, threshold ${thr.toFixed(4)}, ${segs.length} loud segments`);
for (const [a, b] of segs) {
  const s0 = Math.max(0, a * win - 8000), s1 = Math.min(n, b * win + 8000);
  const seg = x.slice(s0, s1);
  let peak = 0, clip = 0, e = 0;
  for (let i = a * win; i < b * win; i++) {
    const v = Math.abs(x[i]);
    peak = Math.max(peak, v);
    if (v > 0.98) clip++;
    e += x[i] ** 2;
  }
  const segRms = Math.sqrt(e / ((b - a) * win));
  const alone = decodeStream(seg).map((d) => d.text);
  console.log(`${(a * win / 16000).toFixed(1)}-${(b * win / 16000).toFixed(1)}s dur ${((b - a) * win / 16000).toFixed(2)}s peak ${peak.toFixed(3)} rms ${segRms.toFixed(4)} snr ${(20 * Math.log10(segRms / floor)).toFixed(1)}dB clip ${clip} -> ${alone.join(',') || 'NO DECODE'}`);
}

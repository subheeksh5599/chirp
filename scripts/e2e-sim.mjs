// Real acoustic loop test: glasses app in the simulator, Mac speaker -> Mac mic.
// 1. starts the glasses dev server and the simulator with automation on
// 2. waits for "[chirp] ready"
// 3. plays N chirps through the speaker with afplay
// 4. counts "[chirp] heard <payload>" lines and saves a lens screenshot
// Usage: node scripts/e2e-sim.mjs [count] [protocol] [volume]
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { soften, dbfs } from '../packages/sound/src/index.js';

const require = createRequire(import.meta.url);
const factory = require('ggwave');

const COUNT = Number(process.argv[2] ?? 5);
const PROTOCOL = process.argv[3] ?? 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL';
const VOLUME = Number(process.argv[4] ?? 40);
const REPEAT = Number(process.argv[5] ?? 1); // send each frame N times back to back
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 2000); // silence between chirps
const SOFT = (process.argv[6] ?? 'soft') === 'soft';
const BASE = 'http://127.0.0.1:9898';
const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const cleanup = () => procs.forEach((p) => { try { p.kill('SIGTERM'); } catch {} });
process.on('exit', cleanup);

function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

async function getJson(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

async function waitFor(marker, timeoutMs, sinceId = 0) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const d = await getJson(`/api/console?since_id=${sinceId}`);
      for (const e of d.entries ?? []) {
        sinceId = Math.max(sinceId, e.id);
        if (String(e.message).includes(marker)) return { found: true, sinceId };
      }
    } catch {}
    await sleep(250);
  }
  return { found: false, sinceId };
}

// never reuse a stale simulator or dev server from an earlier run
try { execFileSync('pkill', ['-f', '[e]venhub-simulator']); } catch {}
try { execFileSync('pkill', ['-f', '[v]ite --host 127.0.0.1 --port 5173']); } catch {}
await sleep(1000);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: new URL('../apps/glasses/', import.meta.url).pathname, stdio: 'ignore',
});
procs.push(vite);
await sleep(2500);
const sim = spawn('evenhub-simulator', ['http://127.0.0.1:5173/?capture=1', '--automation-port', '9898'], { stdio: ['ignore', 'pipe', 'pipe'] });
procs.push(sim);
let simLog = '';
sim.stdout.on('data', (d) => (simLog += d));
sim.stderr.on('data', (d) => (simLog += d));

const ready = await waitFor('[chirp] ready', 40000);
if (!ready.found) {
  console.log('NOT READY. simulator output tail:\n' + simLog.slice(-2000));
  const c = await getJson('/api/console').catch(() => ({}));
  console.log(JSON.stringify(c).slice(0, 2000));
  process.exit(1);
}
console.log('app ready in simulator');
const ping = await fetch(BASE + '/api/ping').then((r) => r.text()).catch(() => 'down');
console.log('simulator ping:', ping);
await fetch('http://127.0.0.1:5173/__capture', { method: 'DELETE' });
writeFileSync(`${OUT}sent.json`, '[]');

const gg = await factory();
const p = gg.getDefaultParameters();
p.sampleRateInp = 48000; p.sampleRateOut = 48000;
const inst = gg.init(p);
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let heard = 0;
let since = ready.sinceId;
const results = [];
for (let i = 0; i < COUNT; i++) {
  let payload = '';
  for (let k = 0; k < 8; k++) payload += A[Math.floor(Math.random() * A.length)];
  const raw = gg.encode(inst, payload, gg.ProtocolId[PROTOCOL], VOLUME);
  const rawF = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const f = SOFT ? soften(rawF, 48000, { repeat: REPEAT }) : rawF;
  if (i === 0) console.log(`chirp length ${(f.length / 48000).toFixed(2)} s, level ${dbfs(f).toFixed(1)} dBFS`);
  const file = `${OUT}chirp-${i}.wav`;
  writeFileSync(file, wav(f, 48000));
  const t0 = Date.now();
  execFileSync('afplay', [file]);
  const r = await waitFor(`[chirp] heard ${payload}`, 4000, since);
  since = r.sinceId;
  const latency = Date.now() - t0;
  if (r.found) heard++;
  results.push({ t_play_ms: t0, payload, decoded: r.found, ms_from_play_start: r.found ? latency : null });
  await sleep(PAUSE_MS);
}
const all = await getJson('/api/console');
console.log((all.entries ?? []).map((e) => e.message).filter((m) => /\[chirp\]/.test(m)).join('\n'));
const png = Buffer.from(await (await fetch(BASE + '/api/screenshot/glasses')).arrayBuffer());
writeFileSync(`${OUT}lens-after.png`, png);
await sleep(1500);
writeFileSync(`${OUT}sent.json`, JSON.stringify(results, null, 2));
console.table(results.map(({ t_play_ms, ...r }) => r));
console.log(`decoded ${heard}/${COUNT} (${PROTOCOL}, volume ${VOLUME}, repeat ${REPEAT}, ${SOFT ? 'soft' : 'raw'}) · lens screenshot: ${OUT}lens-after.png`);
cleanup();
process.exit(0);

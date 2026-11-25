// A real presence run against production, through the air:
// starts a session on prod with a short rule, plays its rotating room codes from this Mac's speaker into the
// running Even Hub simulator (paired to a real Telegram account), ends the session, taps the claim card on
// the lens, and prints the presence id. Anchor it after with `npm run testnet -- anchor <id>`.
//
//   npm run presence:live            needs: simulator on :9898 running the glasses app, paired
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { soften } from '../packages/sound/src/index.js';

const API = process.env.CHIRP_API ?? 'https://chirp-liart-six-38.vercel.app';
const SIM = process.env.SIM ?? 'http://127.0.0.1:9898';
const OUT = new URL('../.artifacts/', import.meta.url).pathname;
const RUN_S = Number(process.env.RUN_S ?? 100); // the rule spans 60 s of slots; leave margin
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gg = await (createRequire(import.meta.url)('ggwave') as () => Promise<any>)();
const params = gg.getDefaultParameters();
params.sampleRateInp = 48000;
params.sampleRateOut = 48000;
const inst = gg.init(params);

function play(frame: string) {
  const raw = gg.encode(inst, frame, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, 12);
  const x = soften(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(), 48000, { repeat: 2 });
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  writeFileSync(`${OUT}presence.wav`, b);
  execFileSync('afplay', [`${OUT}presence.wav`]);
}

async function api<T>(path: string, body?: object, secret?: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j as T;
}

let since = 0;
async function logs(): Promise<string[]> {
  const d = (await (await fetch(`${SIM}/api/console?since_id=${since}`)).json()) as { entries: Array<{ id: number; message: string }> };
  for (const e of d.entries) since = Math.max(since, e.id + 1);
  return d.entries.map((e) => e.message);
}

await logs(); // skip history
const { id, adminSecret } = await api<{ id: string; adminSecret: string }>('/api/sessions', {
  title: 'Presence check',
  slides: [{ title: 'Presence check', note: 'real run, through the air' }],
  rule: { minCodes: 2, minMinutes: 1 },
});
console.log(`session ${id} on prod, rule: 2 codes across 1 minute`);

const heard = new Set<string>();
const end = Date.now() + RUN_S * 1000;
while (Date.now() < end) {
  const { chirp } = await api<{ chirp: { frame: string } }>(`/api/sessions/${id}/admin`, undefined, adminSecret);
  play(chirp.frame);
  await sleep(1500);
  for (const m of await logs()) {
    const hit = /\[chirp\] heard (B\S+)/.exec(m);
    if (hit) heard.add(hit[1]);
  }
  console.log(`  played ${chirp.frame}; glasses heard ${heard.size} room codes so far`);
  await sleep(5000);
}

await api(`/api/sessions/${id}/end`, {}, adminSecret);
console.log(`ended; waiting for the claim card on the lens`);
let claimed = false;
for (let i = 0; i < 40 && !claimed; i++) {
  await sleep(1500);
  for (const m of await logs()) {
    if (/You were here/.test(m) || /card claim/.test(m)) {
      await fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'click' }) });
      claimed = true;
      break;
    }
  }
}
await sleep(4000);
const { one } = await import('../server/db.js');
const p = await one<{ id: string }>(`SELECT id FROM $S.presence WHERE session_id = $1`, [id]);
console.log(p ? `✓ presence record ${p.id} for session ${id}` : `✗ no presence record for session ${id} (claim tapped: ${claimed})`);
if (!p) process.exit(1);

// Full acoustic end-to-end test in the simulator, against a real local API and database:
//   glasses app (simulator) ← sound from the Mac speaker ← a real broadcast session.
// Steps: start API (throwaway schema) + glasses dev server + simulator, read the pairing
// code from the app log, pair it, create a session, chirp the live room code through the
// speaker, and check the lens shows the slide and a tap votes in a poll.
// Usage: npm run e2e:room   (plays soft chirps on your speakers)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { soften } from '../packages/sound/src/index.js';

process.env.DB_SCHEMA = `e2e_${Date.now().toString(36)}`;
process.env.PUBLIC_URL ??= 'http://127.0.0.1:8787';
const { migrate, dropSchema } = await import('../server/migrate.js');
const { pairDevice } = await import('../server/devices.js');
const { createSession, adminSession, currentFrame, setSlide } = await import('../server/sessions.js');

const SIM = 'http://127.0.0.1:9898';
const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const procs: ChildProcess[] = [];
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail]);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const gg = await (createRequire(import.meta.url)('ggwave') as () => Promise<any>)();
const p = gg.getDefaultParameters();
p.sampleRateInp = 48000;
p.sampleRateOut = 48000;
const inst = gg.init(p);

function wav(x: Float32Array) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}
function play(frame: string) {
  const raw = gg.encode(inst, frame, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, 12);
  const f = soften(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(), 48000, { repeat: 2 });
  writeFileSync(`${OUT}room.wav`, wav(f));
  execFileSync('afplay', [`${OUT}room.wav`]);
}

let since = 0;
async function logs(): Promise<string[]> {
  const d = (await (await fetch(`${SIM}/api/console?since_id=${since}`)).json()) as { entries: Array<{ id: number; message: string }> };
  for (const e of d.entries) since = Math.max(since, e.id);
  return d.entries.map((e) => String(e.message));
}
async function waitLog(re: RegExp, ms: number): Promise<RegExpMatchArray | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const m of await logs().catch(() => [])) {
      const hit = m.match(re);
      if (hit) return hit;
    }
    await sleep(300);
  }
  return null;
}
const input = (action: string) =>
  fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });

async function chirpUntil(frameFor: () => Promise<string>, re: RegExp, tries = 4) {
  for (let i = 0; i < tries; i++) {
    play(await frameFor());
    const hit = await waitLog(re, 5000);
    if (hit) return { hit, tries: i + 1 };
  }
  return { hit: null, tries };
}

try {
  try { execFileSync('pkill', ['-f', '[e]venhub-simulator']); } catch {}
  await migrate();
  const env = { ...process.env, PORT: '8787' };
  procs.push(spawn('node', ['--import', 'tsx', 'server/local.ts'], { env, stdio: 'ignore' }));
  procs.push(
    spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: new URL('../apps/glasses/', import.meta.url).pathname,
      env: { ...process.env, VITE_API_BASE: 'http://127.0.0.1:8787' },
      stdio: 'ignore',
    }),
  );
  await sleep(3000);
  procs.push(spawn('evenhub-simulator', ['http://127.0.0.1:5173', '--automation-port', '9898'], { stdio: 'ignore' }));

  const code = await waitLog(/\[chirp\] pairing code=(\d{6})/, 40000);
  check('first launch shows a pairing code', !!code, code?.[1]);
  if (!code) throw new Error('app did not start');
  await pairDevice(code[1], { id: 7_000_001, name: 'E2E Wearer', username: 'e2e' });
  check('pairing is picked up by the lens', !!(await waitLog(/\[chirp\] ready source=glasses/, 10000)));

  const { id, adminSecret } = await createSession({
    title: 'E2E talk',
    slides: [{ title: 'Hello room' }, { title: 'Vote', poll: { question: 'Soft chirps?', a: 'yes', b: 'no' } }],
  });
  const s = await adminSession(id, `Bearer ${adminSecret}`);
  const r1 = await chirpUntil(async () => (await currentFrame(s)).frame, /\[chirp\] card slide E2E talk · 1\/2/);
  check('a room chirp through the air opens the slide card', !!r1.hit, `chirps needed: ${r1.tries}`);

  await setSlide(s, 1);
  const refreshed = await waitLog(/\[chirp\] refreshed E2E talk · 2\/2/, 8000); // the lens polls on its own timer
  writeFileSync(`${OUT}e2e-poll.png`, Buffer.from(await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer()));
  check('slide change reaches the lens without a new chirp', !!refreshed, `screenshot ${OUT}e2e-poll.png`);

  await input('click');
  const voted = await waitLog(/\[chirp\] acted tap → /, 8000);
  const { tally } = await import('../server/sessions.js');
  const t = await tally(id, 1);
  check('tapping the glasses votes in the poll', !!voted && t.a === 1, `votes yes=${t.a} no=${t.b}`);
  writeFileSync(`${OUT}e2e-voted.png`, Buffer.from(await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer()));
} catch (e) {
  check('run completed', false, String((e as Error).message));
} finally {
  procs.forEach((pr) => pr.kill('SIGTERM'));
  try { execFileSync('pkill', ['-f', '[e]venhub-simulator']); } catch {}
  await dropSchema().catch(() => undefined);
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

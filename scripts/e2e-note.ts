// Voice-note end-to-end test in the simulator, against a real local API, database and speech-to-text:
//   a contact card chirps through the air, the wearer taps to connect, holds the touchpad,
//   says a note out loud (the Mac speaks it), lets go, sees the draft on the lens, and taps to send.
// Telegram messages are real: set E2E_WEARER_TG and E2E_OTHER_TG to two Telegram user ids that have
// started the bot, or they default to throwaway ids and only the lens and database are checked.
// Usage: npm run e2e:note   (plays a chirp and a spoken sentence on your speakers)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { soften } from '../packages/sound/src/index.js';

process.env.DB_SCHEMA = `e2e_${Date.now().toString(36)}`;
process.env.PUBLIC_URL ??= 'http://127.0.0.1:8787';
const WEARER = Number(process.env.E2E_WEARER_TG ?? 7_000_101);
const OTHER = Number(process.env.E2E_OTHER_TG ?? 7_000_102);
const REAL_TELEGRAM = !!process.env.E2E_WEARER_TG && !!process.env.E2E_OTHER_TG;
const { migrate, dropSchema } = await import('../server/migrate.js');
const { pairDevice } = await import('../server/devices.js');
const { issueConnect } = await import('../server/handoff.js');
const { q } = await import('../server/db.js');

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gg = await (createRequire(import.meta.url)('ggwave') as () => Promise<any>)();
const p = gg.getDefaultParameters();
p.sampleRateInp = 48000;
p.sampleRateOut = 48000;
const inst = gg.init(p);
function play(frame: string) {
  const raw = gg.encode(inst, frame, gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, 12);
  const x = soften(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(), 48000, { repeat: 2 });
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  writeFileSync(`${OUT}note-card.wav`, b);
  execFileSync('afplay', [`${OUT}note-card.wav`]);
}

let since = 0;
const seen = new Set<number>();
async function logs(): Promise<string[]> {
  const d = (await (await fetch(`${SIM}/api/console?since_id=${since}`)).json()) as { entries: Array<{ id: number; message: string }> };
  // since_id is exclusive on some simulator builds and inclusive on others: ask from the last id seen, skip repeats.
  const fresh = d.entries.filter((e) => !seen.has(e.id));
  for (const e of fresh) {
    seen.add(e.id);
    since = Math.max(since, e.id);
  }
  return fresh.map((e) => String(e.message));
}
const pending: string[] = [];
/** Waits for a matching app log line; lines read past the match stay queued for the next wait. */
async function waitLog(re: RegExp, ms: number): Promise<RegExpMatchArray | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!pending.length) pending.push(...(await logs().catch(() => [])));
    while (pending.length) {
      const m = pending.shift()!;
      if (process.env.E2E_DEBUG && m.startsWith('[chirp]') && !m.includes('event {')) console.log('   log:', m);
      const hit = m.match(re);
      if (hit) return hit;
    }
    await sleep(300);
  }
  return null;
}
const input = (action: string) =>
  fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
const lens = async () => Buffer.from(await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer());

function initDataFor(user: { id: number; first_name: string; username?: string }) {
  const ps = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const check = [...ps.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  ps.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return ps.toString();
}

try {
  try { execFileSync('pkill', ['-f', '[e]venhub-simulator']); } catch {}
  await migrate();
  procs.push(spawn('node', ['--import', 'tsx', 'server/local.ts'], { env: { ...process.env, PORT: '8787' }, stdio: 'ignore' }));
  procs.push(
    spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: new URL('../apps/glasses/', import.meta.url).pathname,
      env: process.env,
      stdio: 'ignore',
    }),
  );
  await sleep(3000);
  procs.push(spawn('evenhub-simulator', ['http://127.0.0.1:5173', '--automation-port', '9898'], { stdio: 'ignore' }));

  const code = await waitLog(/\[chirp\] pairing code=(\d{6})/, 40000);
  check('the dev build reaches the local API through the proxy', !!code, code?.[1]);
  if (!code) throw new Error('app did not start');
  await pairDevice(code[1], { id: WEARER, name: 'E2E Wearer', username: 'e2e_wearer' });
  check('pairing is picked up by the lens', !!(await waitLog(/\[chirp\] ready source=glasses/, 10000)));

  const card = await issueConnect(initDataFor({ id: OTHER, first_name: 'Sam', username: 'sam_e2e' }), 'designer');
  let opened: RegExpMatchArray | null = null;
  for (let i = 0; i < 10 && !opened; i++) {
    play(card.frame);
    opened = await waitLog(/\[chirp\] card connect Sam/, 5000);
  }
  check('the contact card chirped through the air opens on the lens', !!opened);
  await input('click');
  check('a tap connects, and the lens offers a voice note', !!(await waitLog(/\[chirp\] acted tap → Connected with Sam/, 8000)));

  await input('long_press');
  check('holding the touchpad starts recording', !!(await waitLog(/\[chirp\] recording note to Sam/, 5000)));
  await sleep(400);
  execFileSync('say', ['-v', 'Samantha', 'Nice meeting you. Lets grab coffee next week.']);
  await sleep(600);
  await input('long_press_release');
  const recorded = await waitLog(/\[chirp\] note ([\d.]+)s/, 5000);
  check('letting go finishes the note', !!recorded, recorded ? `${recorded[1]} s of audio` : '');
  const draft = await waitLog(/\[chirp\] card draft To Sam:/, 20000);
  writeFileSync(`${OUT}e2e-note-draft.png`, await lens());
  const [row] = await q<{ text: string }>(`SELECT text FROM $S.notes ORDER BY created_at DESC LIMIT 1`);
  check('the spoken words come back as a draft on the lens', !!draft && /meeting/i.test(row?.text ?? ''), `heard: "${row?.text ?? ''}"`);

  await input('click');
  const sent = await waitLog(/\[chirp\] acted tap → Sent to Sam/, 20000);
  const [after] = await q<{ sent_at: string | null }>(`SELECT sent_at FROM $S.notes ORDER BY created_at DESC LIMIT 1`);
  writeFileSync(`${OUT}e2e-note-sent.png`, await lens());
  check(
    `a tap sends it${REAL_TELEGRAM ? " to the other person's Telegram" : ''}`,
    !!sent && !!after?.sent_at,
    REAL_TELEGRAM ? `sent to Telegram user ${OTHER}` : 'throwaway ids: lens and database only',
  );
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

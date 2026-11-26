// The glasses controller driven against the real server router and database (in-process).
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiError, Controller, NOTE_MAX_PCM, type Api, type CardResponse, type MicSource } from '../src/controller.js';
import { route } from '../../../server/router.js';
import { migrate, dropSchema } from '../../../server/migrate.js';
import { setSender, type Outgoing } from '../../../server/notify.js';
import { handleUpdate } from '../../../server/bot.js';
import { one, q } from '../../../server/db.js';
import { adminSession, createSession, currentFrame, setSlide } from '../../../server/sessions.js';
import { issueConnect } from '../../../server/handoff.js';

const outbox: Outgoing[] = [];

async function call<T>(method: string, path: string, token?: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await route({
    method,
    path,
    query: new URLSearchParams(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
  if (r.status >= 400) throw new ApiError(r.status, (r.body as { error: string }).error);
  return r.body as T;
}

const api: Api = {
  createDevice: () => call('POST', '/api/devices'),
  me: (t) => call('GET', '/api/devices/me', t),
  heard: (t, frame, hw) => call<CardResponse>('POST', '/api/heard', t, { frame, hw }),
  act: (t, ref, action) => call<CardResponse>('POST', '/api/act', t, { ref, action }),
  sessionState: (t, id) => call<CardResponse>('GET', `/api/sessions/${id}/state`, t),
  note: (t, ref, audio) => call<CardResponse>('POST', '/api/notes', t, { ref, audio }),
};

function rig() {
  const store = new Map<string, string>();
  const screens: string[] = [];
  const mic: Array<[boolean, MicSource]> = [];
  let exits = 0;
  const c = new Controller({
    api,
    show: async (t) => void screens.push(t),
    setMic: async (on, s) => void mic.push([on, s]),
    exit: async () => void exits++,
    getItem: async (k) => store.get(k) ?? '',
    setItem: async (k, v) => void store.set(k, v),
    log: () => undefined,
    botName: '@test_bot',
  });
  return { c, store, screens, mic, exits: () => exits, lens: () => screens.at(-1) ?? '' };
}

let uid = 8_100_000;
async function pair(c: Controller) {
  const id = ++uid;
  await handleUpdate({ message: { chat: { id, type: 'private' }, from: { id, first_name: 'Wearer', username: 'wearer' }, text: c.pairCode } });
  await c.tick();
  return id;
}

function initDataFor(user: { id: number; first_name: string; username?: string }) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

const SLIDES = [
  { title: 'Intro' },
  { title: 'Poll', poll: { question: 'Coffee or tea?', a: 'coffee', b: 'tea' } },
];

beforeAll(async () => {
  await migrate();
  setSender(async (m) => void outbox.push(m));
}, 60_000);
afterAll(() => dropSchema(), 60_000);

describe('glasses controller', () => {
  it('first launch registers and shows a pairing code, then starts listening once paired', async () => {
    const r = rig();
    await r.c.start();
    expect(r.c.mode).toBe('pairing');
    expect(r.lens()).toMatch(/Open @test_bot and send\n\s+\d{6}/);
    expect(r.store.get('chirp-device-token')).toMatch(/\./);
    await pair(r.c);
    expect(r.c.mode).toBe('root');
    expect(r.mic.at(-1)).toEqual([true, 'glasses']);
    expect(r.lens()).toMatch(/listening \(glasses mic\)/);
  });

  it('a second launch reuses the paired device', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    const r2 = rig();
    r2.store.set('chirp-device-token', r.store.get('chirp-device-token')!);
    await r2.c.start();
    expect(r2.c.mode).toBe('root');
  });

  it('an unknown token is replaced with a fresh device', async () => {
    const r = rig();
    r.store.set('chirp-device-token', `${crypto.randomUUID()}.${'a'.repeat(48)}`);
    await r.c.start();
    expect(r.c.mode).toBe('pairing');
  });

  it('follows the room: slide card, live slide change, tap-to-vote poll', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    const { id, adminSecret } = await createSession({ title: 'Live', slides: SLIDES });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    await r.c.onFrame((await currentFrame(s)).frame);
    expect(r.lens()).toMatch(/^Live · 1\/2\nIntro/);
    await setSlide(s, 1);
    await r.c.tick();
    expect(r.lens()).toMatch(/Poll · Coffee or tea\?/);
    expect(r.lens()).toMatch(/tap: coffee · 2×tap: tea/);
    await r.c.onInput('double');
    expect(r.lens()).toMatch(/You: tea · coffee 0% · tea 100%/);
  });

  it('queues a contact card heard during a talk, swipe shows it, tap connects', async () => {
    const r = rig();
    await r.c.start();
    const wearerTg = await pair(r.c);
    const { id, adminSecret } = await createSession({ title: 'Meetup', slides: SLIDES });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    await r.c.onFrame((await currentFrame(s)).frame);
    const card = await issueConnect(initDataFor({ id: 8_999_001, first_name: 'Sam', username: 'sam' }), 'founder');
    await r.c.onFrame(card.frame);
    expect(r.lens()).toMatch(/\+1 heard · swipe for next/);
    await r.c.onInput('swipe');
    expect(r.lens()).toMatch(/^Sam\nfounder\n@sam/);
    outbox.length = 0;
    await r.c.onInput('tap');
    expect(r.lens()).toMatch(/Connected with Sam/);
    expect(outbox.map((m) => String(m.chatId)).sort()).toEqual([String(wearerTg), '8999001'].sort());
  });

  it('a finished result gives way: the next card replaces "Connected with" instead of queueing', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    const first = await issueConnect(initDataFor({ id: 8_999_002, first_name: 'Ana', username: 'ana' }));
    await r.c.onFrame(first.frame);
    await r.c.onInput('tap');
    expect(r.lens()).toMatch(/Connected with Ana/);
    const second = await issueConnect(initDataFor({ id: 8_999_003, first_name: 'Ben', username: 'ben' }));
    await r.c.onFrame(second.frame);
    expect(r.lens()).toMatch(/^Ben\n@ben/);
    expect(r.lens()).not.toMatch(/heard · swipe for next/);
  });

  it.runIf(!!process.env.GROQ_API_KEY)('after connecting: hold, say a note, let go, tap, and it reaches their Telegram', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    const card = await issueConnect(initDataFor({ id: 8_999_010, first_name: 'Sam', username: 'sam' }));
    await r.c.onFrame(card.frame);
    await r.c.onInput('tap');
    expect(r.lens()).toMatch(/^Connected with Sam[\s\S]*hold: note to Sam · swipe: back$/);
    await r.c.onInput('hold-start');
    expect(r.lens()).toMatch(/^Recording note to Sam/);
    // the glasses mic streams 100 ms chunks while the touchpad is held; real speech from the fixture
    const pcm = readFileSync(new URL('../../../server/test/fixtures/nice-meeting-you.wav', import.meta.url)).subarray(44);
    for (let i = 0; i < pcm.length; i += 3200) expect(r.c.recordNote(pcm.subarray(i, i + 3200))).toBe(true);
    await r.c.onInput('hold');
    expect(r.c.recording).toBeNull();
    expect(r.lens()).toMatch(/^To Sam:\n"Nice meeting you/);
    expect(r.lens()).toMatch(/tap: send · 2×tap: discard/);
    outbox.length = 0;
    await r.c.onInput('tap');
    expect(r.lens()).toMatch(/^Sent to Sam/);
    expect(outbox.map((m) => String(m.chatId))).toEqual(['8999010']);
    expect(outbox[0].text).toMatch(/via Chirp:\n[Nn]ice meeting you/);
  });

  it('every hearing tells the server which hardware and mic heard it', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    await r.c.onFrame('HTEST0000');
    const [row] = await q<{ model: string; mic: string }>(`SELECT model, mic FROM $S.resolves ORDER BY at DESC LIMIT 1`);
    expect(row).toEqual({ model: 'none', mic: 'glasses' });
  });

  it('holding on a card without a note still pauses listening, and chirps are not recorded', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    await r.c.onInput('hold-start');
    expect(r.c.recording).toBeNull();
    expect(r.c.recordNote(new Uint8Array(3200))).toBe(false);
    await r.c.onInput('hold');
    expect(r.c.listening).toBe(false);
  });

  it('a note stops collecting audio at 15 seconds', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    const card = await issueConnect(initDataFor({ id: 8_999_011, first_name: 'Ada' }));
    await r.c.onFrame(card.frame);
    await r.c.onInput('tap');
    await r.c.onInput('hold-start');
    for (let i = 0; i < 200; i++) r.c.recordNote(new Uint8Array(3200));
    const total = r.c.recording!.reduce((a, b) => a + b.byteLength, 0);
    expect(total).toBe(NOTE_MAX_PCM);
  });

  it('a swiped-away room stays quiet but keeps counting presence', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    const { id, adminSecret } = await createSession({ title: 'Quiet', slides: SLIDES });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    const now = Date.now();
    await r.c.onFrame((await currentFrame(s, now)).frame);
    await r.c.onInput('swipe');
    expect(r.c.mode).toBe('root');
    expect(r.lens()).toMatch(/in: Quiet · 1\/2 · tap to open/);
    // next slot's code (5 s later) is heard: no card pops up, hearing is recorded
    const later = (await currentFrame(s, now + 5000)).frame;
    await r.c.onFrame(later.replace(/./, 'B'));
    expect(r.c.mode).toBe('root');
    const device = r.store.get('chirp-device-token')!.split('.')[0];
    const n = await one<{ n: string }>(`SELECT count(*) AS n FROM $S.hearings WHERE device_id = $1 AND session_id = $2`, [device, id]);
    expect(Number(n!.n)).toBeGreaterThanOrEqual(1);
    await r.c.onInput('tap');
    expect(r.c.mode).toBe('card');
  });

  it('a bad chirp never covers a good card, and shows an error when nothing is up', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    await r.c.onFrame('HZZZZZZZZ'); // unknown hand-off token
    expect(r.lens()).toMatch(/Card expired/);
    await r.c.onInput('swipe');
    const { id, adminSecret } = await createSession({ title: 'Keep', slides: SLIDES });
    await r.c.onFrame((await currentFrame(await adminSession(id, `Bearer ${adminSecret}`))).frame);
    const before = r.lens();
    await r.c.onFrame('HZZZZZZZZ');
    expect(r.lens()).toBe(before);
  });

  it('root gestures: swipe switches mic, hold pauses, double-tap exits', async () => {
    const r = rig();
    await r.c.start();
    await pair(r.c);
    await r.c.onInput('swipe');
    expect(r.mic.at(-1)).toEqual([true, 'phone']);
    expect(r.store.get('mic-source')).toBe('phone');
    await r.c.onInput('hold');
    expect(r.c.listening).toBe(false);
    expect(r.lens()).toMatch(/paused/);
    await r.c.onInput('hold');
    expect(r.c.listening).toBe(true);
    await r.c.onInput('double');
    expect(r.exits()).toBe(1);
    expect(r.mic.at(-1)?.[0]).toBe(false);
  });

  it('ignores chirps and only allows exit while pairing', async () => {
    const r = rig();
    await r.c.start();
    await r.c.onFrame('BABCDEFGH');
    expect(r.c.mode).toBe('pairing');
    await r.c.onInput('double');
    expect(r.exits()).toBe(1);
  });
});

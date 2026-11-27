import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codeForSlot, encodeFrame, hexToBytes, slotOf } from '../../packages/wire/src/index.js';
import { migrate, dropSchema } from '../migrate.js';
import { one, q } from '../db.js';
import { setSender, type Outgoing } from '../notify.js';
import { createDevice, deviceFromAuth, type Device } from '../devices.js';
import { act, heard, hearingTally, sessionState, RESOLVES_PER_MINUTE } from '../app.js';
import { createSession, currentFrame, endSession, getSession, setSlide, tally, adminSession } from '../sessions.js';
import { checkPayment, issueBill, issueConnect, issueLink } from '../handoff.js';
import { createMarker, paperPositions } from '../markers.js';
import { searchMarkets } from '../polymarket.js';
import { handleUpdate } from '../bot.js';
import { route } from '../router.js';
import { verifyRecord } from '../crypto.js';
import { esc, verifyInitData } from '../telegram.js';
import { LENS_GLYPHS, lensSafe, render, wrap } from '../lens.js';
import { draftNote, NOTE_MAX_BYTES } from '../notes.js';
import { parseSuggestions, recentRoom, suggestMessages } from '../suggest.js';
import { readFileSync } from 'node:fs';

const outbox: Outgoing[] = [];
const sentTo = (chatId: number) => outbox.filter((m) => String(m.chatId) === String(chatId));

let uid = 9_000_000;
async function pairedDevice(name = 'Test Wearer', username = 'wearer') {
  const d = await createDevice();
  const id = ++uid;
  await handleUpdate({ message: { chat: { id, type: 'private' }, from: { id, first_name: name, username }, text: `/start ${d.pairCode}` } });
  const device = await deviceFromAuth(`Bearer ${d.token}`);
  expect(sentTo(id).at(-1)?.text).toMatch(/Paired/);
  // keep each test's outbox about the behaviour under test, not the pairing reply
  for (let i = outbox.length - 1; i >= 0; i--) if (String(outbox[i].chatId) === String(id)) outbox.splice(i, 1);
  return { ...d, device, tgId: id };
}

function initDataFor(user: { id: number; first_name: string; username?: string }, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

/** These call Groq for real (Whisper speech-to-text or the suggestion model), so they need GROQ_API_KEY. Everything else runs with nothing configured. */
const withGroq = it.runIf(!!process.env.GROQ_API_KEY);

const SLIDES = [
  { title: 'Why glasses need ears', note: 'No camera, no NFC, no BLE scan' },
  { title: 'Ship weekly?', poll: { question: 'Ship weekly or monthly?', a: 'weekly', b: 'monthly' } },
];

beforeAll(async () => {
  await migrate();
  setSender(async (m) => void outbox.push(m));
}, 60_000);
afterAll(async () => {
  await dropSchema();
}, 60_000);
beforeEach(() => {
  outbox.length = 0;
});

describe('devices and pairing', () => {
  it('issues a device token and a 6-digit pairing code', async () => {
    const d = await createDevice();
    expect(d.pairCode).toMatch(/^\d{6}$/);
    const dev = await deviceFromAuth(`Bearer ${d.token}`);
    expect(dev.tg_user_id).toBeNull();
  });
  it('rejects malformed and wrong tokens', async () => {
    const d = await createDevice();
    await expect(deviceFromAuth(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(deviceFromAuth(`Bearer ${d.deviceId}.${'0'.repeat(48)}`)).rejects.toMatchObject({ status: 401 });
  });
  it('pairs through the bot and clears the code', async () => {
    const { device, tgId } = await pairedDevice('Ada', 'ada');
    expect(String(device.tg_user_id)).toBe(String(tgId));
    expect(device.pair_code).toBeNull();
  });
  it('a bare 6-digit message also pairs; a wrong code is refused', async () => {
    const d = await createDevice();
    await handleUpdate({ message: { chat: { id: 77, type: 'private' }, from: { id: 77, first_name: 'X' }, text: '000000' } });
    expect(outbox.at(-1)!.text).toMatch(/not valid/);
    await handleUpdate({ message: { chat: { id: 78, type: 'private' }, from: { id: 78, first_name: 'Y' }, text: d.pairCode } });
    expect(outbox.at(-1)!.text).toMatch(/Paired/);
  });
  it('an unpaired device is told how to pair', async () => {
    const d = await createDevice();
    const c = await heard(await deviceFromAuth(`Bearer ${d.token}`), 'BABCDEFGH');
    expect(c.kind).toBe('error');
    expect(c.lines.join(' ')).toMatch(/pair/i);
  });
});

describe('broadcast sessions', () => {
  it('validates input', async () => {
    await expect(createSession({ title: '', slides: SLIDES })).rejects.toMatchObject({ status: 400 });
    await expect(createSession({ title: 'T', slides: [] })).rejects.toMatchObject({ status: 400 });
    await expect(createSession({ title: 'T', slides: SLIDES, deckUrl: 'http://x' })).rejects.toMatchObject({ status: 400 });
    await expect(createSession({ title: 'T', slides: [{ poll: { question: 'q' } }] })).rejects.toMatchObject({ status: 400 });
    await expect(createSession({ title: 'T', slides: SLIDES, rule: { minCodes: 1 } })).rejects.toMatchObject({ status: 400 });
  });
  it('only the owner can control a session', async () => {
    const { id, adminSecret } = await createSession({ title: 'Talk', slides: SLIDES });
    await expect(adminSession(id, 'Bearer ' + '0'.repeat(48))).rejects.toMatchObject({ status: 401 });
    expect((await adminSession(id, `Bearer ${adminSecret}`)).id).toBe(id);
  });
  it('hearing the current code joins the room and shows the slide', async () => {
    const { device } = await pairedDevice();
    const { id } = await createSession({ title: 'Glasses talk', slides: SLIDES, deckUrl: 'https://example.com/deck' });
    const s = await getSession(id);
    const { frame } = await currentFrame(s);
    const c = await heard(device, frame);
    expect(c.kind).toBe('slide');
    expect(c.live).toBe(true);
    expect(c.lines[0]).toBe('Glasses talk · 1/2');
    expect(c.tap).toBe('save links');
    const log = await one(`SELECT kind, title FROM $S.heard_log WHERE device_id = $1`, [device.id]);
    expect(log).toMatchObject({ kind: 'talk', title: 'Glasses talk' });
  });
  it('rejects a recording of an old code and a forged code', async () => {
    const { device } = await pairedDevice();
    const { id } = await createSession({ title: 'Replay test', slides: SLIDES });
    const s = await getSession(id);
    const old = await codeForSlot(hexToBytes(s.key_hex), slotOf(Date.now()) - 3);
    expect((await heard(device, encodeFrame({ type: 'B', code: old }))).kind).toBe('error');
    const forged = await codeForSlot(hexToBytes('ab'.repeat(32)), slotOf(Date.now()));
    expect((await heard(device, encodeFrame({ type: 'B', code: forged }))).kind).toBe('error');
    expect((await heard(device, 'not a frame')).kind).toBe('error');
  });
  it('logs each rejected code with why it was refused', async () => {
    const { device } = await pairedDevice();
    const { id } = await createSession({ title: 'Replay log', slides: SLIDES });
    const s = await getSession(id);
    const old = encodeFrame({ type: 'B', code: await codeForSlot(hexToBytes(s.key_hex), slotOf(Date.now()) - 3) });
    await heard(device, old);
    await heard(device, 'not a frame');
    const now = (await currentFrame(s)).frame;
    await heard(device, now);
    const rows = await q<{ frame: string; outcome: string }>(
      `SELECT frame, outcome FROM $S.resolves WHERE device_id = $1 ORDER BY at`,
      [device.id],
    );
    expect(rows).toEqual([
      { frame: old, outcome: 'room-code-rejected' },
      { frame: 'not a frame', outcome: 'not-a-code' },
      { frame: now, outcome: 'ok' },
    ]);
  });
  it('a device spamming chirps is slowed down; other devices are not', async () => {
    const spammer = await pairedDevice();
    const other = await pairedDevice();
    for (let i = 0; i < RESOLVES_PER_MINUTE; i++) await heard(spammer.device, 'HZZZZZZZZ');
    await expect(heard(spammer.device, 'HZZZZZZZZ')).rejects.toMatchObject({ status: 429 });
    expect((await heard(other.device, 'HZZZZZZZZ')).kind).toBe('error');
    const http = await route({
      method: 'POST', path: '/api/heard', query: new URLSearchParams(),
      headers: { authorization: `Bearer ${spammer.token}` }, body: { frame: 'HZZZZZZZZ' },
    });
    expect(http.status).toBe(429);
  });
  it('the sound-test chirp says it was heard instead of looking like an expired card', async () => {
    const { device } = await pairedDevice();
    const c = await heard(device, 'HTEST0000');
    expect(c.kind).toBe('info');
    expect(c.lines[0]).toBe('Sound test heard');
    const [row] = await q<{ outcome: string }>(`SELECT outcome FROM $S.resolves WHERE device_id = $1`, [device.id]);
    expect(row.outcome).toBe('sound-test');
  });
  it('tap saves links to Telegram on a normal slide', async () => {
    const { device, tgId } = await pairedDevice();
    const { id } = await createSession({ title: 'Links', slides: SLIDES, deckUrl: 'https://example.com/d', channelUrl: 'https://t.me/x' });
    await heard(device, (await currentFrame(await getSession(id))).frame);
    const c = await act(device, { type: 'session', id }, 'tap');
    expect(c.lines[0]).toMatch(/Links sent/);
    const m = sentTo(tgId).at(-1)!;
    expect(m.text).toContain('https://example.com/d');
    expect(m.buttons?.flat().map((b) => b.text)).toEqual(['Open deck', 'Join channel']);
  });
  it('polls: tap votes A, double-tap votes B, and the lens shows the tally', async () => {
    const a = await pairedDevice();
    const b = await pairedDevice();
    const { id, adminSecret } = await createSession({ title: 'Poll talk', slides: SLIDES });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    await setSlide(s, 1);
    const frame = (await currentFrame(s)).frame;
    expect((await heard(a.device, frame)).tap).toBe('weekly');
    await heard(b.device, frame);
    await act(a.device, { type: 'session', id }, 'tap');
    const after = await act(b.device, { type: 'session', id }, 'double');
    expect(after.lines.at(-1)).toMatch(/You: monthly · weekly 50% · monthly 50%/);
    expect(await tally(id, 1)).toEqual({ a: 1, b: 1, total: 2 });
  });
  it('a device that never heard the room cannot vote or read its state', async () => {
    const { device } = await pairedDevice();
    const { id, adminSecret } = await createSession({ title: 'Closed', slides: SLIDES });
    await setSlide(await adminSession(id, `Bearer ${adminSecret}`), 1);
    await expect(act(device, { type: 'session', id }, 'tap')).rejects.toMatchObject({ status: 403 });
    await expect(sessionState(device, id)).rejects.toMatchObject({ status: 403 });
  });
  it('slide index is range-checked', async () => {
    const { id, adminSecret } = await createSession({ title: 'Range', slides: SLIDES });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    await expect(setSlide(s, 5)).rejects.toMatchObject({ status: 400 });
    await expect(setSlide(s, -1)).rejects.toMatchObject({ status: 400 });
  });
});

describe('presence', () => {
  it('codes spread over the session qualify; a claim is signed and sent to Telegram', async () => {
    const { device, tgId } = await pairedDevice();
    const { id, adminSecret } = await createSession({ title: 'Presence talk', slides: SLIDES, rule: { minCodes: 3, minMinutes: 10 } });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    const now = Date.now();
    for (const ago of [12, 6, 0]) {
      const t = now - ago * 60_000;
      await heard(device, (await currentFrame(s, t)).frame, t);
    }
    await endSession(s);
    const claimCard = await sessionState(device, id);
    expect(claimCard).toMatchObject({ kind: 'presence', tap: 'claim' });
    expect(claimCard.lines[0]).toMatch(/You were here · 12 min/);
    const done = await act(device, { type: 'presence', id }, 'tap');
    expect(done.lines[0]).toMatch(/claimed/);
    const msg = sentTo(tgId).at(-1)!;
    expect(msg.text).toMatch(/Presence record/);
    const anchor = msg.buttons!.flat().find((b) => b.url)!.url!;
    expect(anchor).toContain('app.tonkeeper.com/transfer/');
    expect(decodeURIComponent(anchor)).toMatch(/chirp:presence:[0-9A-Z]{8}/);
    const p = await one<{ id: string; record: object; signature: string }>(`SELECT id, record, signature FROM $S.presence WHERE device_id = $1`, [device.id]);
    expect(verifyRecord(p!.record, p!.signature)).toBe(true);
    expect(verifyRecord({ ...p!.record, minutes: 999 }, p!.signature)).toBe(false);
    const pub = await route({ method: 'GET', path: `/api/presence/${p!.id}`, query: new URLSearchParams(), headers: {}, body: {} });
    expect(pub.body).toMatchObject({ signatureValid: true, anchor: null });
    await expect(act(device, { type: 'presence', id }, 'tap')).rejects.toMatchObject({ status: 409 });
  });
  it('one code shared in a chat does not qualify', async () => {
    const { device } = await pairedDevice();
    const { id, adminSecret } = await createSession({ title: 'Shared code', slides: SLIDES });
    const s = await adminSession(id, `Bearer ${adminSecret}`);
    await heard(device, (await currentFrame(s)).frame);
    await endSession(s);
    const c = await sessionState(device, id);
    expect(c.kind).toBe('info');
    expect(c.lines.join(' ')).toMatch(/1 of 3 codes/);
    await expect(act(device, { type: 'presence', id }, 'tap')).rejects.toMatchObject({ status: 403 });
  });
});

describe('hand-off: contact cards', () => {
  it('requires valid Telegram initData', async () => {
    await expect(issueConnect('', 'x')).rejects.toMatchObject({ status: 400 });
    const good = initDataFor({ id: 4242, first_name: 'Sam' });
    expect(verifyInitData(good).id).toBe(4242);
    await expect(issueConnect(good.replace('Sam', 'Eve'), 'x')).rejects.toMatchObject({ status: 401 });
    const stale = initDataFor({ id: 4242, first_name: 'Sam' }, Math.floor(Date.now() / 1000) - 3 * 86400);
    await expect(issueConnect(stale, 'x')).rejects.toMatchObject({ status: 401 });
  });
  it('wearer hears a card, taps, and both people get a Telegram message', async () => {
    const wearer = await pairedDevice('Priya Rao', 'priya');
    const sam = { id: 5150, first_name: 'Sam', username: 'samreyes' };
    const { frame } = await issueConnect(initDataFor(sam), 'founder, Tidepool');
    const c = await heard(wearer.device, frame);
    expect(c).toMatchObject({ kind: 'connect', tap: 'connect' });
    expect(c.lines).toEqual(['Sam', 'founder, Tidepool', '@samreyes']);
    const done = await act(wearer.device, c.ref, 'tap');
    expect(done.lines[0]).toBe('Connected with Sam');
    expect(done.kind).toBe('connected');
    expect(sentTo(5150)[0].text).toMatch(/Priya Rao.*@priya.*just met you through Chirp/);
    expect(sentTo(wearer.tgId)[0].text).toMatch(/Saved contact: <b>Sam<\/b> · founder, Tidepool · @samreyes/);
    const row = await one(`SELECT other_name, role FROM $S.contacts WHERE device_id = $1`, [wearer.device.id]);
    expect(row).toMatchObject({ other_name: 'Sam', role: 'founder, Tidepool' });
  });
  it('your own card and expired cards are refused', async () => {
    const me = await pairedDevice('Me', 'me');
    const own = await issueConnect(initDataFor({ id: me.tgId, first_name: 'Me' }), '');
    const c = await heard(me.device, own.frame);
    await expect(act(me.device, c.ref, 'tap')).rejects.toMatchObject({ status: 409 });
    const other = await issueConnect(initDataFor({ id: 6161, first_name: 'Late' }), '');
    await q(`UPDATE $S.handoffs SET expires_at = now() - interval '1 second' WHERE token = $1`, [other.token]);
    expect((await heard(me.device, other.frame)).kind).toBe('error');
  });
});

describe('hand-off: bills (testnet)', () => {
  it('validates amounts', async () => {
    await expect(issueBill({ shop: '', amountTon: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(issueBill({ shop: 'Café', amountTon: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(issueBill({ shop: 'Café', amountTon: 50 })).rejects.toMatchObject({ status: 400 });
  });
  it('tap sends a wallet link with a unique comment; unpaid until it is on-chain', async () => {
    const { device, tgId } = await pairedDevice();
    const bill = await issueBill({ shop: 'Café Noor', amountTon: 0.25, memo: 'flat white' });
    const c = await heard(device, bill.frame);
    expect(c).toMatchObject({ kind: 'pay', tap: 'pay on phone' });
    expect(c.lines).toEqual(['Café Noor', '0.25 TON · testnet', 'flat white']);
    await act(device, c.ref, 'tap');
    const link = sentTo(tgId)[0].buttons![0][0].url!;
    const u = new URL(link);
    expect(u.pathname).toBe(`/transfer/${process.env.TON_WALLET_ADDRESS}`);
    expect(u.searchParams.get('amount')).toBe('250000000');
    expect(u.searchParams.get('text')).toBe(`chirp:pay:${bill.payId}`);
    // Real testnet lookup: nobody has paid this fresh bill.
    expect(await checkPayment(bill.payId)).toMatchObject({ paid: false, amountTon: 0.25, shop: 'Café Noor' });
  });
});

describe('hand-off: links and notes', () => {
  it('validates input', async () => {
    await expect(issueLink({ title: '' })).rejects.toMatchObject({ status: 400 });
    await expect(issueLink({ title: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(issueLink({ title: 'x', url: 'http://plain' })).rejects.toMatchObject({ status: 400 });
    await expect(issueLink({ title: 'x', note: 'n', minutes: 500 })).rejects.toMatchObject({ status: 400 });
  });
  it('a host shares a link in a voice chat; tap saves it to Telegram and /heard', async () => {
    const { device, tgId } = await pairedDevice();
    const l = await issueLink({ title: 'Launch thread', url: 'https://example.com/launch', from: 'Host', minutes: 15 });
    expect(l.expiresInS).toBe(900);
    const c = await heard(device, l.frame);
    expect(c).toMatchObject({ kind: 'link', tap: 'save to Telegram' });
    expect(c.lines).toEqual(['Launch thread', 'from Host']);
    const done = await act(device, c.ref, 'tap');
    expect(done.lines[0]).toBe('Saved to Telegram');
    const m = sentTo(tgId)[0];
    expect(m.text).toContain('https://example.com/launch');
    expect(m.buttons?.[0][0]).toMatchObject({ text: 'Open link', url: 'https://example.com/launch' });
    await handleUpdate({ message: { chat: { id: tgId, type: 'private' }, from: { id: tgId, first_name: 'T' }, text: '/heard' } });
    expect(sentTo(tgId).at(-1)!.text).toMatch(/🔗 Launch thread/);
  });
  it('a note without a link works too (Wi-Fi at the door)', async () => {
    const { device } = await pairedDevice();
    const l = await issueLink({ title: 'Office Wi-Fi', note: 'network Studio5 · password tidepool-24' });
    expect((await heard(device, l.frame)).lines).toEqual(['Office Wi-Fi', 'network Studio5 · password tidepool-24']);
  });
});

describe('sender previews match the lens exactly', () => {
  const req = (method: string, path: string, body = {}, headers = {}) =>
    route({ method, path, query: new URLSearchParams(), headers, body });
  it('the console shows the same text a listener gets, slide and poll', async () => {
    const { device } = await pairedDevice();
    const { id, adminSecret } = await createSession({ title: 'Preview talk', slides: SLIDES });
    const auth = { authorization: `Bearer ${adminSecret}` };
    for (const index of [0, 1]) {
      const s = await adminSession(id, auth.authorization);
      if (index) await setSlide(s, index);
      const admin = (await req('GET', `/api/sessions/${id}/admin`, {}, auth)).body as { lens: string; chirp: { frame: string } };
      const heardCard = await heard(device, admin.chirp.frame);
      expect(render(heardCard)).toBe(admin.lens);
    }
  });
  it('an ended session has no preview', async () => {
    const { id, adminSecret } = await createSession({ title: 'Done talk', slides: SLIDES });
    await endSession(await adminSession(id, `Bearer ${adminSecret}`));
    const r = (await req('GET', `/api/sessions/${id}/admin`, {}, { authorization: `Bearer ${adminSecret}` })).body as { lens: unknown };
    expect(r.lens).toBeNull();
  });
  it('a link hand-off previews exactly what the wearer sees', async () => {
    const { device } = await pairedDevice();
    const l = await issueLink({ title: 'Slides from today', url: 'https://example.com/d', note: 'the full deck', from: 'Ana' });
    expect(render(await heard(device, l.frame))).toBe(l.lens);
    expect(l.lens).toContain('Slides from today');
  });
  it('a bill previews exactly what the wearer sees', async () => {
    const { device } = await pairedDevice();
    const b = await issueBill({ shop: 'Preview Café', amountTon: 0.25, memo: 'one tea' });
    expect(render(await heard(device, b.frame))).toBe(b.lens);
    expect(b.lens).toMatch(/0\.25 TON · testnet/);
  });
});

describe('single-use contact cards and bills: a recorded chirp is useless after the first tap', () => {
  const sam = () => ({ id: 6100 + Math.floor(Math.random() * 1000), first_name: 'Sam', username: 'samreyes' });

  it('the first tap connects; a second wearer who taps or hears it later gets "Card already used"', async () => {
    const a = await pairedDevice('Ana', 'ana');
    const b = await pairedDevice('Ben', 'ben');
    const owner = sam();
    const card = await issueConnect(initDataFor(owner), 'founder');
    const seenByA = await heard(a.device, card.frame);
    const seenByB = await heard(b.device, card.frame); // both heard it while it was fresh
    expect((await act(a.device, seenByA.ref, 'tap')).kind).toBe('connected');
    expect(await act(b.device, seenByB.ref, 'tap')).toMatchObject({ kind: 'error', lines: ['Card already used', 'ask them to chirp again'] });
    // the same chirp replayed later (a recording) opens nothing
    expect(await heard(b.device, card.frame)).toMatchObject({ kind: 'error', lines: ['Card already used', 'ask them to chirp again'] });
    const rows = await q(`SELECT 1 FROM $S.contacts WHERE other_tg_id = $1`, [owner.id]);
    expect(rows).toHaveLength(1); // only Ana saved Sam
    expect(sentTo(owner.id).filter((m) => /just met you/.test(m.text))).toHaveLength(1);
    const [r] = await q<{ outcome: string }>(`SELECT outcome FROM $S.resolves WHERE device_id = $1 ORDER BY at DESC LIMIT 1`, [b.device.id]);
    expect(r.outcome).toBe('card-used');
  });

  it('the wearer who claimed it is told it is done, and nothing is sent twice', async () => {
    const a = await pairedDevice('Ana', 'ana2');
    const owner = sam();
    const card = await issueConnect(initDataFor(owner), undefined);
    const c = await heard(a.device, card.frame);
    await act(a.device, c.ref, 'tap');
    expect((await act(a.device, c.ref, 'tap')).lines[0]).toBe('Already connected with Sam');
    expect((await heard(a.device, card.frame)).lines[0]).toBe('Already connected with Sam');
    expect(sentTo(owner.id).filter((m) => /just met you/.test(m.text))).toHaveLength(1);
  });

  it('two wearers tapping at the same instant: exactly one connects', async () => {
    const a = await pairedDevice('Ana', 'ana3');
    const b = await pairedDevice('Ben', 'ben3');
    const owner = sam();
    const card = await issueConnect(initDataFor(owner), undefined);
    const [ca, cb] = [await heard(a.device, card.frame), await heard(b.device, card.frame)];
    const results = await Promise.all([act(a.device, ca.ref, 'tap'), act(b.device, cb.ref, 'tap')]);
    expect(results.map((r) => r.kind).sort()).toEqual(['connected', 'error']);
    expect(await q(`SELECT 1 FROM $S.contacts WHERE other_tg_id = $1`, [owner.id])).toHaveLength(1);
  });

  it('tapping your own card, or double-tapping to ignore, does not burn the code', async () => {
    const owner = await pairedDevice('Sam', 'sam_own');
    const a = await pairedDevice('Ana', 'ana4');
    const card = await issueConnect(initDataFor({ id: owner.tgId, first_name: 'Sam' }), undefined);
    const own = await heard(owner.device, card.frame);
    await expect(act(owner.device, own.ref, 'tap')).rejects.toMatchObject({ status: 409 });
    const c = await heard(a.device, card.frame);
    expect((await act(a.device, c.ref, 'double')).lines[0]).toBe('Ignored');
    expect((await act(a.device, c.ref, 'tap')).kind).toBe('connected');
  });

  it('a bill is claimed by the first payer; a second phone gets no wallet link', async () => {
    const a = await pairedDevice('Ana', 'ana5');
    const b = await pairedDevice('Ben', 'ben5');
    const bill = await issueBill({ shop: 'Cafe Noor', amountTon: 0.1 });
    const [ca, cb] = [await heard(a.device, bill.frame), await heard(b.device, bill.frame)];
    expect((await act(a.device, ca.ref, 'tap')).lines[0]).toBe('Payment link sent');
    expect((await act(b.device, cb.ref, 'tap')).lines[0]).toBe('Card already used');
    expect(sentTo(b.tgId).filter((m) => /Open your wallet/.test(m.text))).toHaveLength(0);
    expect((await act(a.device, ca.ref, 'tap')).lines[0]).toBe('Payment link already sent');
    expect(sentTo(a.tgId).filter((m) => /Open your wallet/.test(m.text))).toHaveLength(1);
  });

  it('a shared link stays open: everyone who heard it can save it', async () => {
    const a = await pairedDevice('Ana', 'ana6');
    const b = await pairedDevice('Ben', 'ben6');
    const link = await issueLink({ title: 'Launch thread', url: 'https://example.com/thread', from: 'Host' });
    for (const w of [a, b]) {
      const c = await heard(w.device, link.frame);
      expect((await act(w.device, c.ref, 'tap')).lines[0]).toBe('Saved to Telegram');
    }
  });
});

describe('AI follow-up suggestions after connecting', () => {
  it('keeps only clean, short, distinct messages from whatever the model returns', () => {
    expect(parseSuggestions('not json')).toEqual([]);
    expect(parseSuggestions('{"messages": "one string"}')).toEqual([]);
    expect(
      parseSuggestions(
        JSON.stringify({
          messages: [
            '  "Great meeting you, Sam!"  ',
            'great meeting you, sam!',
            'Check out https://evil.example now',
            'DM me at @someone',
            'x'.repeat(81),
            42,
            'Coffee next week?',
            'Tell me more about Tidepool',
            'A fourth one that is dropped',
          ],
        }),
      ),
    ).toEqual(['Great meeting you, Sam!', 'Coffee next week?', 'Tell me more about Tidepool']);
  });

  it('with no model key the Connected card simply has no suggestions', async () => {
    const saved = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      expect(await suggestMessages({ theirName: 'Sam' })).toEqual([]);
      const w = await pairedDevice('Ana', 'ana_nokey');
      const card = await issueConnect(initDataFor({ id: 7700 + Math.floor(Math.random() * 200), first_name: 'Sam' }), undefined);
      const done = await act(w.device, (await heard(w.device, card.frame)).ref, 'tap');
      expect(done).toMatchObject({ kind: 'connected', ref: { type: 'contact' }, lines: ['Connected with Sam', 'both of you got a message'] });
      expect(done.tap).toBeUndefined();
    } finally {
      if (saved) process.env.GROQ_API_KEY = saved;
    }
  });

  it('the room you were both in becomes "where we met"', async () => {
    const w = await pairedDevice('Ana', 'ana_room');
    const { id } = await createSession({ title: 'Founders breakfast', slides: SLIDES });
    await heard(w.device, (await currentFrame(await getSession(id))).frame);
    expect(await recentRoom(w.device.id)).toBe('Founders breakfast');
    expect(await recentRoom((await pairedDevice('Ben', 'ben_room')).device.id)).toBeNull();
  });

  withGroq('the real model offers suggestions: double-tap shows the next, tap sends that one to their Telegram', async () => {
    const w = await pairedDevice('Priya Rao', 'priya_s');
    const sam = { id: 7900 + Math.floor(Math.random() * 99), first_name: 'Sam', username: 'samreyes' };
    const card = await issueConnect(initDataFor(sam), 'founder, Tidepool');
    const first = await act(w.device, (await heard(w.device, card.frame)).ref, 'tap');
    expect(first).toMatchObject({ kind: 'connected', ref: { type: 'note' }, tap: 'send', voice: 'note to Sam' });
    expect(first.lines[0]).toBe('Connected with Sam');
    expect(first.lines[1]).toMatch(/^Send: "/);
    expect(first.double).toMatch(/^next 1\/[23]$/);
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM $S.notes WHERE source = 'suggested' AND contact_id = (SELECT contact_id FROM $S.notes WHERE id = $1)`, [first.ref!.id]);
    expect(n).toBeGreaterThanOrEqual(2);
    const rows = await q<{ text: string }>(`SELECT text FROM $S.notes WHERE contact_id = (SELECT contact_id FROM $S.notes WHERE id = $1)`, [first.ref!.id]);
    for (const r of rows) expect(r.text.length).toBeLessThanOrEqual(80);
    expect(sentTo(sam.id).filter((m) => /via Chirp/.test(m.text))).toHaveLength(0); // nothing sent until a tap

    const second = await act(w.device, first.ref, 'double');
    expect(second.double).toMatch(/^next 2\//);
    expect(second.ref!.id).not.toBe(first.ref!.id);
    const chosen = (await one<{ text: string }>(`SELECT text FROM $S.notes WHERE id = $1`, [second.ref!.id]))!.text;

    const sent = await act(w.device, second.ref, 'tap');
    expect(sent.lines[0]).toBe('Sent to Sam');
    const msg = sentTo(sam.id).filter((m) => /via Chirp/.test(m.text));
    expect(msg).toHaveLength(1);
    expect(msg[0].text).toContain(esc(chosen));
    // the other suggestions are gone, and tapping again never sends twice
    await expect(act(w.device, first.ref, 'tap')).rejects.toMatchObject({ status: 404 });
    expect((await act(w.device, second.ref, 'tap')).lines[0]).toBe('Already sent to Sam');
  });
});

describe('which hardware heard a chirp (the real-G2 evidence trail)', () => {
  it('records the model and mic the glasses report, and cleans up anything else', async () => {
    const { device } = await pairedDevice('Gee', 'gee');
    await heard(device, 'HTEST0000', Date.now(), { model: 'g2', mic: 'glasses' });
    await heard(device, 'HTEST0000', Date.now(), { model: 'g2', mic: 'phone' });
    await heard(device, 'HTEST0000', Date.now(), { model: 'simulator', mic: 'glasses' });
    await heard(device, 'HTEST0000', Date.now(), { model: '<script>', mic: 42 });
    await heard(device, 'HTEST0000');
    const rows = await q<{ model: string; mic: string; outcome: string }>(
      `SELECT model, mic, outcome FROM $S.resolves WHERE device_id = $1 ORDER BY at`,
      [device.id],
    );
    expect(rows.map((r) => `${r.model}/${r.mic}/${r.outcome}`)).toEqual([
      'g2/glasses/sound-test',
      'g2/phone/sound-test',
      'simulator/glasses/sound-test',
      'unknown/unknown/sound-test',
      'unknown/unknown/sound-test',
    ]);
  });

  it('the public tally counts decodes by hardware, with no device or account in it', async () => {
    const { device } = await pairedDevice('Gee', 'gee2');
    await heard(device, 'HTEST0000', Date.now(), { model: 'g2', mic: 'glasses' });
    await heard(device, 'not a frame', Date.now(), { model: 'g2', mic: 'glasses' });
    const t = await hearingTally();
    const g2 = t.rows.find((r) => r.model === 'g2' && r.mic === 'glasses')!;
    expect(g2.heard).toBeGreaterThanOrEqual(2);
    expect(g2.decoded).toBeGreaterThanOrEqual(1);
    expect(g2.decoded).toBeLessThan(g2.heard);
    expect(JSON.stringify(t)).not.toMatch(new RegExp(device.id));
    const r = await route({ method: 'GET', path: '/api/hearing', query: new URLSearchParams(), headers: {}, body: {} });
    expect(r.status).toBe(200);
  });
});

describe('voice note after connecting (real speech-to-text)', () => {
  const speech = readFileSync(new URL('./fixtures/nice-meeting-you.wav', import.meta.url)).toString('base64');
  async function connected() {
    const wearer = await pairedDevice('Priya Rao', 'priya');
    const sam = { id: 5250 + Math.floor(Math.random() * 1000), first_name: 'Sam', username: 'samreyes' };
    const card = await issueConnect(initDataFor(sam), 'founder');
    const done = await act(wearer.device, (await heard(wearer.device, card.frame)).ref, 'tap');
    return { wearer, sam, done };
  }

  it('the connected card offers hold-to-speak, and the lens says so', async () => {
    const { done } = await connected();
    expect(done).toMatchObject({ kind: 'connected', voice: 'note to Sam' });
    expect(render(done)).toMatch(/hold: note to Sam(?: · |\n)swipe: back$/);
  });

  withGroq('hold, speak, tap: the words are drafted on the lens, then sent to their Telegram', async () => {
    const { wearer, sam, done } = await connected();
    const draft = await draftNote(wearer.device, done.ref, speech);
    expect(draft).toMatchObject({ kind: 'draft', tap: 'send', double: 'discard' });
    expect(draft.lines[0]).toBe('To Sam:');
    expect(draft.lines.slice(1).join(' ').toLowerCase()).toMatch(/nice meeting you/);
    expect(sentTo(sam.id).filter((m) => /via Chirp/.test(m.text))).toHaveLength(0); // nothing sent before the tap
    const sent = await act(wearer.device, draft.ref, 'tap');
    expect(sent.lines[0]).toBe('Sent to Sam');
    const msg = sentTo(sam.id).at(-1)!;
    expect(msg.text).toMatch(/Priya Rao.*@priya.*via Chirp:\n.*[Nn]ice meeting you/);
    expect(msg.buttons?.[0][0]).toMatchObject({ text: 'Reply to Priya Rao', url: 'https://t.me/priya' });
    expect((await act(wearer.device, draft.ref, 'tap')).lines[0]).toBe('Already sent to Sam'); // a second tap never resends
    expect(sentTo(sam.id).filter((m) => /via Chirp/.test(m.text))).toHaveLength(1);
  });

  withGroq('double-tap discards the draft and nothing is sent', async () => {
    const { wearer, sam, done } = await connected();
    const draft = await draftNote(wearer.device, done.ref, speech);
    expect((await act(wearer.device, draft.ref, 'double')).lines[0]).toBe('Note discarded');
    expect(sentTo(sam.id).filter((m) => /via Chirp/.test(m.text))).toHaveLength(0);
    await expect(act(wearer.device, draft.ref, 'tap')).rejects.toMatchObject({ status: 404 });
  });

  it('a press too short to hold speech asks again, without calling speech-to-text', async () => {
    const { wearer, done } = await connected();
    const blip = Buffer.alloc(44 + 3200).toString('base64');
    const c = await draftNote(wearer.device, done.ref, blip);
    expect(c).toMatchObject({ kind: 'error', lines: ["Didn't catch that", 'hold, speak, then let go'], ref: { type: 'contact' }, voice: 'note to Sam' });
  });

  withGroq('only the wearer who made the contact can draft or send to it', async () => {
    const { wearer, done } = await connected();
    const stranger = await pairedDevice('Mallory', 'mallory');
    await expect(draftNote(stranger.device, done.ref, speech)).rejects.toMatchObject({ status: 404 });
    const draft = await draftNote(wearer.device, done.ref, speech);
    await expect(act(stranger.device, draft.ref, 'tap')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a missing ref, missing audio and clips over 15 seconds', async () => {
    const { wearer, done } = await connected();
    await expect(draftNote(wearer.device, { type: 'session', id: 'X' }, speech)).rejects.toMatchObject({ status: 400 });
    await expect(draftNote(wearer.device, done.ref, undefined)).rejects.toMatchObject({ status: 400 });
    const long = Buffer.alloc(NOTE_MAX_BYTES + 2).toString('base64');
    await expect(draftNote(wearer.device, done.ref, long)).rejects.toMatchObject({ status: 413 });
  });

  withGroq('the route drafts a note for an authorised device', async () => {
    const { wearer, done } = await connected();
    const r = await route({
      method: 'POST', path: '/api/notes', query: new URLSearchParams(),
      headers: { authorization: `Bearer ${wearer.token}` }, body: { ref: done.ref, audio: speech },
    });
    expect(r.status).toBe(200);
    expect((r.body as { text: string }).text).toMatch(/^To Sam:/);
    expect((await route({ method: 'POST', path: '/api/notes', query: new URLSearchParams(), headers: {}, body: {} })).status).toBe(401);
  });
});

describe('sync markers (live market data)', () => {
  it('search returns live markets with a YES price', async () => {
    const ms = await searchMarkets('bitcoin');
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) expect(m.yes).toBeGreaterThanOrEqual(0);
  });
  it('a stream marker shows the market; tap saves it, double-tap opens a paper position', async () => {
    const { device, tgId } = await pairedDevice();
    const [market] = (await searchMarkets('bitcoin')).filter((m) => m.yes > 0.01 && m.yes < 0.99);
    expect(market).toBeDefined();
    const mk = await createMarker(market.id);
    const c = await heard(device, mk.frame);
    expect(c.kind).toBe('market');
    expect(c.lines.at(-1)).toMatch(/^YES \d+% · \$/);
    await act(device, c.ref, 'tap');
    expect(sentTo(tgId)[0].text).toContain('📈');
    const p = await act(device, c.ref, 'double');
    expect(p.lines[0]).toMatch(/Paper YES at \d+%/);
    const pos = await paperPositions([device.id]);
    expect(pos).toHaveLength(1);
    expect(typeof pos[0].pnl).toBe('number');
    await handleUpdate({ message: { chat: { id: tgId, type: 'private' }, from: { id: tgId, first_name: 'T' }, text: '/paper' } });
    expect(sentTo(tgId).at(-1)!.text).toMatch(/Paper positions/);
  });
  it('rejects bad market ids', async () => {
    await expect(createMarker('abc')).rejects.toMatchObject({ status: 400 });
  });
});

describe('bot log commands', () => {
  it('/heard lists what the glasses caught; /met lists contacts', async () => {
    const w = await pairedDevice('Lee', 'lee');
    const { id } = await createSession({ title: 'Morning standup', slides: SLIDES });
    await heard(w.device, (await currentFrame(await getSession(id))).frame);
    const card = await issueConnect(initDataFor({ id: 7272, first_name: 'Noor' }), 'designer');
    await act(w.device, (await heard(w.device, card.frame)).ref, 'tap');
    await handleUpdate({ message: { chat: { id: w.tgId, type: 'private' }, from: { id: w.tgId, first_name: 'Lee' }, text: '/heard' } });
    const h = sentTo(w.tgId).at(-1)!.text;
    expect(h).toMatch(/🎤 Morning standup/);
    expect(h).toMatch(/👋 Noor/);
    await handleUpdate({ message: { chat: { id: w.tgId, type: 'private' }, from: { id: w.tgId, first_name: 'Lee' }, text: '/met' } });
    expect(sentTo(w.tgId).at(-1)!.text).toMatch(/Noor · designer/);
  });
  it('the share link (?start=me) answers with one button straight into the Mini App', async () => {
    await handleUpdate({ message: { chat: { id: 7474, type: 'private' }, from: { id: 7474, first_name: 'Noor' }, text: '/start me' } });
    const m = sentTo(7474).at(-1)!;
    expect(m.text).toMatch(/Tap <b>Chirp my card<\/b>/);
    expect(m.buttons).toEqual([[{ text: 'Chirp my card', web_app: { url: expect.stringMatching(/\/mini\.html$/) } }]]);
  });
  it('the person who was met gets the Mini App under the message, so their next swap is one tap', async () => {
    const w = await pairedDevice('Lee', 'lee');
    const card = await issueConnect(initDataFor({ id: 7575, first_name: 'Noor' }), undefined);
    await act(w.device, (await heard(w.device, card.frame)).ref, 'tap');
    const buttons = sentTo(7575).at(-1)!.buttons!.flat();
    expect(buttons.map((b) => b.text)).toEqual(['Message Lee', 'Chirp my card to someone']);
    expect(buttons[1]).toMatchObject({ web_app: { url: expect.stringMatching(/\/mini\.html$/) } });
  });
  it('the person who chirped their card, with no glasses, also gets the contact in /met', async () => {
    const w = await pairedDevice('Lee', 'lee');
    const card = await issueConnect(initDataFor({ id: 7373, first_name: 'Noor', username: 'noor' }), 'designer');
    await act(w.device, (await heard(w.device, card.frame)).ref, 'tap');
    expect(sentTo(7373).at(-1)!.text).toMatch(/Lee.*just met you through Chirp\. Saved to your contacts/);
    await handleUpdate({ message: { chat: { id: 7373, type: 'private' }, from: { id: 7373, first_name: 'Noor' }, text: '/met' } });
    expect(sentTo(7373).at(-1)!.text).toMatch(/People you met[\s\S]*Lee · @lee/);
    // meeting again updates, never duplicates, on both sides
    const again = await issueConnect(initDataFor({ id: 7373, first_name: 'Noor', username: 'noor' }), undefined);
    await act(w.device, (await heard(w.device, again.frame)).ref, 'tap');
    const rows = await q<{ owner_tg_id: string }>(`SELECT owner_tg_id FROM $S.contacts WHERE other_tg_id IN ($1, 7373) AND owner_tg_id IN ($1, 7373)`, [w.tgId]);
    expect(rows).toHaveLength(2);
  });
  it('anything else gets help with the Mini App button', async () => {
    await handleUpdate({ message: { chat: { id: 31, type: 'private' }, from: { id: 31, first_name: 'Z' }, text: 'hi' } });
    expect(outbox.at(-1)!.buttons![0][0].web_app?.url).toMatch(/\/mini\.html$/);
  });
});

describe('router', () => {
  const req = (method: string, path: string, body = {}, headers = {}) =>
    route({ method, path, query: new URLSearchParams(), headers, body });
  it('health, 404 and auth errors', async () => {
    expect((await req('GET', '/api/health')).status).toBe(200);
    expect((await req('GET', '/api/nope')).status).toBe(404);
    expect((await req('POST', '/api/heard', { frame: 'BABCDEFGH' })).status).toBe(401);
    expect((await req('POST', '/api/telegram', {}, { 'x-telegram-bot-api-secret-token': 'wrong' })).status).toBe(401);
  });
  it.skipIf(!!process.env.CHIRP_LOCAL_BOT)('config reports the bot name read from the real Telegram token', async () => {
    const r = await req('GET', '/api/config');
    expect(r.status).toBe(200);
    expect((r.body as { bot: string }).bot).toMatch(/^[A-Za-z0-9_]{5,}bot$/i);
  });
  it('device flow over HTTP returns lens text', async () => {
    const created = await req('POST', '/api/devices');
    expect(created.status).toBe(201);
    const token = (created.body as { token: string }).token;
    const me = await req('GET', '/api/devices/me', {}, { authorization: `Bearer ${token}` });
    expect(me.body).toMatchObject({ paired: false });
    const h = await req('POST', '/api/heard', { frame: 'BABCDEFGH' }, { authorization: `Bearer ${token}` });
    expect((h.body as { text: string }).text).toMatch(/Not paired yet/);
  });
});

describe('lens font', () => {
  it('only characters the G2 font can draw reach the lens', () => {
    const out = render({ kind: 'info', lines: ['✓ Saved “quoted” — ok’s', 'Café Noor → 0.5 TON'], tap: 'connect' });
    for (const line of out.split('\n')) expect(line, line).toMatch(LENS_GLYPHS);
    expect(out.split('\n')[0]).toBe('Saved "quoted" - ok\'s');
    expect(out.split('\n')[1]).toBe('Cafe Noor > 0.5 TON');
  });
  it('keeps the hint symbols that render on the lens', () => {
    expect(lensSafe('tap: a · 2×tap: b…')).toBe('tap: a · 2×tap: b…');
    expect(lensSafe('Ana Müller 🎉')).toBe('Ana Muller ?');
  });
});

describe('lens layout', () => {
  it('wraps to 40 columns and caps lines', () => {
    const lines = wrap('a '.repeat(60), 40, 2);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(wrap('x'.repeat(90), 40, 3)).toEqual(['x'.repeat(40), 'x'.repeat(40), 'x'.repeat(10)]);
  });
  it('renders hints for tap, double-tap and swipe', () => {
    const t = render({ kind: 'poll', lines: ['Q'], tap: 'yes', double: 'no' });
    expect(t.split('\n').at(-1)).toBe('tap: yes · 2×tap: no · swipe: back');
  });
});

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codeForSlot, encodeFrame, hexToBytes, slotOf } from '../../packages/wire/src/index.js';
import { migrate, dropSchema } from '../migrate.js';
import { one, q } from '../db.js';
import { setSender, type Outgoing } from '../notify.js';
import { createDevice, deviceFromAuth, type Device } from '../devices.js';
import { act, heard, sessionState } from '../app.js';
import { createSession, currentFrame, endSession, getSession, setSlide, tally, adminSession } from '../sessions.js';
import { checkPayment, issueBill, issueConnect, issueLink } from '../handoff.js';
import { createMarker, paperPositions } from '../markers.js';
import { searchMarkets } from '../polymarket.js';
import { handleUpdate } from '../bot.js';
import { route } from '../router.js';
import { verifyRecord } from '../crypto.js';
import { verifyInitData } from '../telegram.js';
import { render, wrap } from '../lens.js';

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
    expect(done.lines[0]).toBe('✓ Connected with Sam');
    expect(sentTo(5150)[0].text).toMatch(/Priya Rao.*@priya.*wants to connect/);
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
    expect(done.lines[0]).toBe('✓ Saved to Telegram');
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

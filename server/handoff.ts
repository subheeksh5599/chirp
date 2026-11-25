// Hand-off: one sender, one wearer. Contact cards from the Mini App, bills from a counter page.
import { encodeFrame, randomCode } from '../packages/wire/src/index.js';
import { one, q } from './db.js';
import { env, HttpError } from './env.js';
import { Card, wrap } from './lens.js';
import { Device, logHeard } from './devices.js';
import { notify } from './notify.js';
import { displayName, esc, verifyInitData } from './telegram.js';
import { findPayment, nanoToTon, tonToNano, transferLink, explorerTx } from './ton.js';

const HANDOFF_TTL_S = 60;
const MAX_PAY_TON = 5;

type ConnectPayload = { name: string; username?: string; role?: string };
type LinkPayload = { title: string; url?: string; note?: string; from?: string };
type PayPayload = { shop: string; amountNano: string; memo?: string };
type Handoff = { token: string; kind: 'connect' | 'pay' | 'link'; owner_tg_id: string | null; payload: ConnectPayload & PayPayload & LinkPayload; expires_at: string };

async function issue(kind: Handoff['kind'], ownerTgId: number | null, payload: object, ttlS = HANDOFF_TTL_S) {
  const token = randomCode(8);
  await q(
    `INSERT INTO $S.handoffs (token, kind, owner_tg_id, payload, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [token, kind, ownerTgId, JSON.stringify(payload), ttlS],
  );
  return { token, frame: encodeFrame({ type: 'H', code: token }), expiresInS: ttlS };
}

/** A link or short note anyone can chirp: "the link is in the chat", Wi-Fi details, a menu. */
export async function issueLink(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 60) : '';
  if (!title) throw new HttpError(400, 'title is required');
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (rawUrl && !/^https:\/\/\S+$/.test(rawUrl)) throw new HttpError(400, 'link must start with https://');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  if (!rawUrl && !note) throw new HttpError(400, 'add a link or a note');
  const from = typeof body.from === 'string' ? body.from.trim().slice(0, 40) : '';
  const minutes = Number(body.minutes ?? 10);
  if (!(minutes >= 1 && minutes <= 120)) throw new HttpError(400, 'minutes must be 1–120');
  return issue('link', null, { title, url: rawUrl.slice(0, 500) || undefined, note: note || undefined, from: from || undefined }, Math.round(minutes * 60));
}

export async function issueConnect(initData: unknown, role: unknown) {
  if (typeof initData !== 'string' || !initData) throw new HttpError(400, 'open this page from the bot in Telegram');
  const user = verifyInitData(initData);
  const r = typeof role === 'string' ? role.trim().slice(0, 60) : '';
  return issue('connect', user.id, { name: displayName(user), username: user.username, role: r || undefined });
}

export async function issueBill(body: Record<string, unknown>) {
  const shop = typeof body.shop === 'string' ? body.shop.trim().slice(0, 40) : '';
  if (!shop) throw new HttpError(400, 'shop name is required');
  const amount = Number(body.amountTon);
  if (!(amount > 0 && amount <= MAX_PAY_TON)) throw new HttpError(400, `amount must be between 0 and ${MAX_PAY_TON} TON (testnet)`);
  const memo = typeof body.memo === 'string' ? body.memo.trim().slice(0, 60) : undefined;
  const issued = await issue('pay', null, { shop, amountNano: tonToNano(amount).toString(), memo });
  const payId = randomCode(8);
  await q(
    `INSERT INTO $S.payments (id, token, shop, amount_nano, comment) VALUES ($1, $2, $3, $4, $5)`,
    [payId, issued.token, shop, tonToNano(amount).toString(), `chirp:pay:${payId}`],
  );
  return { ...issued, payId };
}

export async function liveHandoff(token: string): Promise<Handoff | null> {
  return one<Handoff>(`SELECT * FROM $S.handoffs WHERE token = $1 AND expires_at > now()`, [token]);
}

export async function handoffCard(device: Device, h: Handoff): Promise<Card> {
  const ref = { type: 'handoff' as const, id: h.token };
  if (h.kind === 'connect') {
    const p = h.payload;
    await logHeard(device.id, 'contact', h.token, p.name, { username: p.username, role: p.role });
    return {
      kind: 'connect', ref,
      lines: [p.name, ...(p.role ? wrap(p.role, 40, 1) : []), p.username ? `@${p.username}` : 'Telegram contact'],
      tap: 'connect',
      double: 'ignore',
    };
  }
  if (h.kind === 'link') {
    const p = h.payload;
    await logHeard(device.id, 'link', h.token, p.title, { url: p.url, note: p.note, from: p.from });
    return {
      kind: 'link', ref,
      lines: [...wrap(p.title, 40, 2), ...(p.note ? wrap(p.note, 40, 2) : []), ...(p.from ? [`from ${p.from}`] : [])],
      tap: 'save to Telegram',
      double: 'ignore',
    };
  }
  const p = h.payload;
  await logHeard(device.id, 'bill', h.token, p.shop, { amountNano: p.amountNano, memo: p.memo });
  return {
    kind: 'pay', ref,
    lines: [p.shop, `${nanoToTon(p.amountNano)} TON · testnet`, ...(p.memo ? wrap(p.memo, 40, 1) : [])],
    tap: 'pay on phone',
    double: 'ignore',
  };
}

export async function connect(device: Device & { tg_user_id: string }, h: Handoff) {
  const other = h.payload;
  if (!h.owner_tg_id) throw new HttpError(409, 'card has no owner');
  if (String(h.owner_tg_id) === String(device.tg_user_id)) throw new HttpError(409, 'that is your own card');
  await q(
    `INSERT INTO $S.contacts (device_id, other_tg_id, other_name, other_username, role) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_id, other_tg_id) DO UPDATE SET met_at = now(), role = coalesce(excluded.role, $S.contacts.role)`,
    [device.id, h.owner_tg_id, other.name, other.username ?? null, other.role ?? null],
  );
  const me = device.tg_name ?? 'Someone';
  const meLink = device.tg_username ? `https://t.me/${device.tg_username}` : null;
  await notify(
    h.owner_tg_id,
    `👋 <b>${esc(me)}</b>${device.tg_username ? ` (@${esc(device.tg_username)})` : ''} just met you through Chirp and wants to connect.`,
    meLink ? [[{ text: `Message ${me}`, url: meLink }]] : undefined,
  );
  const otherLink = other.username ? `https://t.me/${other.username}` : null;
  await notify(
    device.tg_user_id,
    `Saved contact: <b>${esc(other.name)}</b>${other.role ? ` · ${esc(other.role)}` : ''}${other.username ? ` · @${esc(other.username)}` : ''}\nThey got your intro.`,
    otherLink ? [[{ text: `Message ${other.name}`, url: otherLink }]] : undefined,
  );
}

export async function sendPayLink(device: Device & { tg_user_id: string }, h: Handoff) {
  const pay = await one<{ id: string; comment: string; amount_nano: string; shop: string }>(
    `UPDATE $S.payments SET device_id = $2 WHERE token = $1 RETURNING id, comment, amount_nano, shop`,
    [h.token, device.id],
  );
  if (!pay) throw new HttpError(404, 'bill not found');
  await notify(
    device.tg_user_id,
    `🧾 <b>${esc(pay.shop)}</b> · ${nanoToTon(pay.amount_nano)} TON (testnet)\nOpen your wallet to confirm. Nothing is sent until you approve it there.`,
    [
      [{ text: `Pay ${nanoToTon(pay.amount_nano)} TON`, url: transferLink(env.tonAddress, BigInt(pay.amount_nano), pay.comment) }],
      [{ text: 'I paid, check', callback_data: `pay:${pay.id}` }],
    ],
  );
  return pay.id;
}

/** Look for the payment on-chain (testnet) and mark it paid. Used by the counter page and the bot. */
export async function checkPayment(payId: string) {
  const p = await one<{ id: string; comment: string; amount_nano: string; shop: string; tx_hash: string | null; paid_at: string | null }>(
    `SELECT id, comment, amount_nano, shop, tx_hash, paid_at FROM $S.payments WHERE id = $1`,
    [payId],
  );
  if (!p) throw new HttpError(404, 'payment not found');
  if (p.tx_hash) return { paid: true, shop: p.shop, amountTon: nanoToTon(p.amount_nano), tx: explorerTx(p.tx_hash) };
  const tx = await findPayment(p.comment, BigInt(p.amount_nano));
  if (!tx) return { paid: false, shop: p.shop, amountTon: nanoToTon(p.amount_nano) };
  await q(`UPDATE $S.payments SET tx_hash = $2, paid_at = now() WHERE id = $1`, [p.id, tx.hash]);
  return { paid: true, shop: p.shop, amountTon: nanoToTon(p.amount_nano), tx: explorerTx(tx.hash) };
}

export async function saveLink(device: Device & { tg_user_id: string }, h: Handoff) {
  const p = h.payload;
  await notify(
    device.tg_user_id,
    [`🔗 <b>${esc(p.title)}</b>`, p.note ? esc(p.note) : '', p.url ? esc(p.url) : '', p.from ? `from ${esc(p.from)}` : '']
      .filter(Boolean)
      .join('\n'),
    p.url ? [[{ text: 'Open link', url: p.url }]] : undefined,
  );
}

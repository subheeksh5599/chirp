// Sync markers: a stream host tags a market; the chirp in the stream audio brings it to the lens.
import { encodeFrame, randomCode } from '../packages/wire/src/index.js';
import { one, q } from './db.js';
import { HttpError } from './env.js';
import { Card, wrap } from './lens.js';
import { Device, logHeard } from './devices.js';
import { notify } from './notify.js';
import { esc } from './telegram.js';
import { getMarket, pct, usd } from './polymarket.js';

const MARKER_TTL_H = 6;
export const PAPER_STAKE = 10;

export async function createMarker(marketId: unknown) {
  if (typeof marketId !== 'string') throw new HttpError(400, 'marketId is required');
  const m = await getMarket(marketId);
  const token = randomCode(8);
  await q(
    `INSERT INTO $S.markers (token, market_id, question, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [token, m.id, m.question, MARKER_TTL_H],
  );
  return { token, frame: encodeFrame({ type: 'S', code: token }), market: m };
}

export async function liveMarker(token: string) {
  return one<{ token: string; market_id: string; question: string }>(
    `SELECT token, market_id, question FROM $S.markers WHERE token = $1 AND expires_at > now()`,
    [token],
  );
}

export async function markerCard(device: Device, token: string, marketId: string): Promise<Card> {
  const m = await getMarket(marketId);
  await logHeard(device.id, 'market', m.id, m.question, { yes: m.yes });
  return {
    kind: 'market',
    ref: { type: 'marker', id: token },
    lines: [...wrap(m.question, 40, 2), `YES ${pct(m.yes)} · ${usd(m.volume24h)} 24h`],
    tap: 'save',
    double: `paper YES $${PAPER_STAKE}`,
  };
}

const marketUrl = (id: string) => `https://polymarket.com/market/${id}`;

export async function saveMarket(device: Device & { tg_user_id: string }, marketId: string) {
  const m = await getMarket(marketId);
  await notify(device.tg_user_id, `📈 <b>${esc(m.question)}</b>\nYES ${pct(m.yes)} · ${usd(m.volume24h)} traded in 24h`, [
    [{ text: 'Open market', url: marketUrl(m.id) }],
  ]);
}

export async function paperYes(device: Device & { tg_user_id: string }, marketId: string) {
  const m = await getMarket(marketId);
  if (m.yes <= 0 || m.yes >= 1) throw new HttpError(409, 'market price is at a bound, no paper position');
  await q(
    `INSERT INTO $S.paper (device_id, market_id, question, side, entry_price, stake) VALUES ($1, $2, $3, 'YES', $4, $5)`,
    [device.id, m.id, m.question, m.yes, PAPER_STAKE],
  );
  await notify(
    device.tg_user_id,
    `🧪 Paper position (no real money): YES on <b>${esc(m.question)}</b> at ${pct(m.yes)}, $${PAPER_STAKE}.\nSee all with /paper.`,
  );
  return m;
}

/** Paper P&L at today's price. A YES share bought at p pays 1 if YES; value now = stake * now/p. */
export async function paperPositions(deviceIds: string[]) {
  if (!deviceIds.length) return [];
  const rows = await q<{ market_id: string; question: string; entry_price: string; stake: string; created_at: string }>(
    `SELECT market_id, question, entry_price, stake, created_at FROM $S.paper WHERE device_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 20`,
    [deviceIds],
  );
  const out = [];
  for (const r of rows) {
    const entry = Number(r.entry_price);
    const stake = Number(r.stake);
    let now: number | null = null;
    try {
      now = (await getMarket(r.market_id)).yes;
    } catch {
      now = null;
    }
    out.push({ question: r.question, entry, now, stake, pnl: now === null ? null : stake * (now / entry) - stake });
  }
  return out;
}

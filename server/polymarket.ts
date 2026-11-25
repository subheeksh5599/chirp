// Public, read-only prediction market data (no key). Used for sync markers and paper positions.
import { HttpError } from './env.js';

const GAMMA = 'https://gamma-api.polymarket.com';
const UA = { 'user-agent': 'Mozilla/5.0 (Chirp)' };

/** Public API calls occasionally reset; retry twice with a short backoff before failing. */
async function get(url: URL | string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status < 500) return r;
      last = new Error(`status ${r.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  throw new HttpError(502, `market data unavailable: ${String((last as Error)?.message ?? last)}`);
}

export type Market = { id: string; question: string; yes: number; volume24h: number; endDate?: string };

type RawMarket = {
  id: string;
  question: string;
  outcomes?: string;
  outcomePrices?: string;
  volume24hr?: number;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
};

function toMarket(m: RawMarket): Market | null {
  try {
    const outcomes = JSON.parse(m.outcomes ?? '[]') as string[];
    const prices = (JSON.parse(m.outcomePrices ?? '[]') as string[]).map(Number);
    const i = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
    if (i < 0 || !Number.isFinite(prices[i])) return null;
    return { id: String(m.id), question: m.question, yes: prices[i], volume24h: m.volume24hr ?? 0, endDate: m.endDate };
  } catch {
    return null;
  }
}

export async function getMarket(id: string): Promise<Market> {
  if (!/^\d+$/.test(id)) throw new HttpError(400, 'market id must be numeric');
  const r = await get(`${GAMMA}/markets/${id}`);
  if (!r.ok) throw new HttpError(502, `market ${id}: ${r.status}`);
  const m = toMarket((await r.json()) as RawMarket);
  if (!m) throw new HttpError(502, `market ${id} has no YES price`);
  return m;
}

export async function searchMarkets(query: string, limit = 8): Promise<Market[]> {
  const u = new URL(`${GAMMA}/public-search`);
  u.searchParams.set('q', query);
  u.searchParams.set('limit_per_type', '6');
  u.searchParams.set('events_status', 'active');
  const r = await get(u);
  if (!r.ok) throw new HttpError(502, `market search: ${r.status}`);
  const j = (await r.json()) as { events?: Array<{ markets?: RawMarket[] }> };
  const out: Market[] = [];
  for (const e of j.events ?? []) {
    for (const raw of e.markets ?? []) {
      if (raw.closed || raw.active === false) continue;
      const m = toMarket(raw);
      if (m) out.push(m);
    }
  }
  return out.sort((a, b) => b.volume24h - a.volume24h).slice(0, limit);
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

// TON testnet: payment links and confirmation by reading the receiving wallet's transactions.
import { env, HttpError } from './env.js';

const API = 'https://testnet.toncenter.com/api/v2';
export const NANO = 1_000_000_000n;

export function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) throw new HttpError(400, 'amount must be a positive number');
  return BigInt(Math.round(ton * 1e9));
}

export const nanoToTon = (n: bigint | string | number) => Number(BigInt(n)) / 1e9;

/** Tonkeeper universal link. The wearer opens it on their phone and confirms there. */
export function transferLink(to: string, amountNano: bigint, comment: string): string {
  const u = new URL(`https://app.tonkeeper.com/transfer/${to}`);
  u.searchParams.set('amount', amountNano.toString());
  u.searchParams.set('text', comment);
  return u.toString();
}

export type InTx = { hash: string; fromAddr: string; valueNano: bigint; comment: string; utime: number };

export async function recentIncoming(address = env.tonAddress, limit = 30): Promise<InTx[]> {
  const u = new URL(`${API}/getTransactions`);
  u.searchParams.set('address', address);
  u.searchParams.set('limit', String(limit));
  const headers: Record<string, string> = {};
  if (env.toncenterKey) headers['X-API-Key'] = env.toncenterKey;
  // Free toncenter allows ~1 request/second; back off and retry on rate limits or worker hiccups.
  let r: Response | null = null;
  let j: TxResponse | null = null;
  for (let i = 0; i < 4; i++) {
    r = await fetch(u, { headers });
    j = (await r.json().catch(() => null)) as TxResponse | null;
    if (j?.ok) break;
    await new Promise((res) => setTimeout(res, 1100 * (i + 1)));
  }
  if (!j?.ok) throw new HttpError(502, `toncenter: ${j?.error ?? r?.status}`);
  return parseTxs(j);
}

type TxResponse = {
    ok: boolean;
    error?: string;
    result: Array<{
      utime: number;
      transaction_id: { hash: string };
      in_msg?: { source?: string; value?: string; message?: string };
    }>;
};

function parseTxs(j: TxResponse): InTx[] {
  return j.result
    .filter((t) => t.in_msg?.source)
    .map((t) => ({
      hash: t.transaction_id.hash,
      fromAddr: t.in_msg!.source!,
      valueNano: BigInt(t.in_msg!.value ?? '0'),
      comment: t.in_msg!.message ?? '',
      utime: t.utime,
    }));
}

/** First incoming transaction carrying `comment` with at least `minNano`. */
export async function findPayment(comment: string, minNano: bigint): Promise<InTx | null> {
  const txs = await recentIncoming();
  return txs.find((t) => t.comment.trim() === comment && t.valueNano >= minNano) ?? null;
}

export const explorerTx = (hash: string) =>
  `https://testnet.tonviewer.com/transaction/${Buffer.from(hash, 'base64').toString('hex')}`;

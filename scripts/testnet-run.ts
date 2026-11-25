// Real TON testnet runs against production, paid from the payer wallet (scripts/testnet-payer.ts):
//
//   npm run testnet -- bill               issue a bill on prod, pay it, wait until prod marks it paid
//   npm run testnet -- anchor <presenceId>  pay the anchor for a presence record, then run the bot's own check
//
// Prints the explorer link of the transaction the receiving wallet saw, which is what the README links.
import { execFileSync } from 'node:child_process';

const API = process.env.CHIRP_API ?? 'https://chirp-liart-six-38.vercel.app';
const TO = process.env.TON_WALLET_ADDRESS;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pay(amountTon: string, comment: string) {
  if (!TO) throw new Error('TON_WALLET_ADDRESS is not set');
  const out = execFileSync('node', ['--env-file=.env', '--import', 'tsx', 'scripts/testnet-payer.ts', 'pay', TO, amountTon, comment], {
    encoding: 'utf8',
  });
  process.stdout.write(out);
}

async function api<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j as T;
}

async function bill() {
  const b = await api<{ payId: string; lens: string }>('/api/handoff/bill', { shop: 'Testnet check', amountTon: 0.05, memo: 'end-to-end run' });
  console.log(`bill ${b.payId} issued on prod; lens shows:\n${b.lens}\n`);
  pay('0.05', `chirp:pay:${b.payId}`);
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const p = await api<{ paid: boolean; tx?: string }>(`/api/pay/${b.payId}`);
    if (p.paid) return console.log(`✓ prod marked bill ${b.payId} paid: ${p.tx}`);
  }
  throw new Error(`bill ${b.payId} not seen as paid after 150 s`);
}

async function anchor(id: string) {
  if (!/^[0-9A-Z]{8}$/.test(id ?? '')) throw new Error('usage: anchor <presenceId>');
  const before = await api<{ anchor: { explorer: string } | null }>(`/api/presence/${id}`);
  if (before.anchor) return console.log(`already anchored: ${before.anchor.explorer}`);
  pay('0.01', `chirp:presence:${id}`);
  const { checkAnchor } = await import('../server/bot.js');
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const msg = await checkAnchor(id);
    if (!msg.startsWith('Not on testnet yet')) return console.log(msg);
  }
  throw new Error(`anchor for ${id} not seen after 150 s`);
}

const [cmd, arg] = process.argv.slice(2);
(cmd === 'bill' ? bill() : cmd === 'anchor' ? anchor(arg) : Promise.reject(new Error('usage: bill | anchor <presenceId>'))).catch(
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

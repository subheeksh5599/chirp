// A testnet-only payer wallet, so bills and presence anchors can be paid by a real transfer from a
// wallet other than the receiving one. The mnemonic lives only in .env (gitignored, chmod 600).
//
//   npm run payer -- new                       create the wallet, store TON_PAYER_MNEMONIC in .env, print its address
//   npm run payer -- address | balance
//   npm run payer -- pay <to> <amountTon> <comment>   send a transfer with a text comment; prints the tx hash
import { appendFileSync, readFileSync } from 'node:fs';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { Address, SendMode, TonClient, WalletContractV4, internal, fromNano, toNano } from '@ton/ton';

const ENDPOINT = 'https://testnet.toncenter.com/api/v2/jsonRPC';
const client = new TonClient({ endpoint: ENDPOINT, apiKey: process.env.TONCENTER_API_KEY || undefined });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function wallet() {
  const words = process.env.TON_PAYER_MNEMONIC?.trim().split(/\s+/);
  if (!words || words.length !== 24) throw new Error('TON_PAYER_MNEMONIC is not set; run `npm run payer -- new` first');
  const key = await mnemonicToPrivateKey(words);
  const contract = WalletContractV4.create({ workchain: 0, publicKey: key.publicKey });
  return { key, contract, opened: client.open(contract) };
}

const friendly = (a: Address) => a.toString({ testOnly: true, bounceable: false });

/** toncenter's free tier allows about one request a second; retry the transient failures. */
async function retry<T>(f: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'new') {
    if (process.env.TON_PAYER_MNEMONIC) throw new Error('TON_PAYER_MNEMONIC already set in .env; refusing to replace it');
    const words = await mnemonicNew(24);
    const env = readFileSync('.env', 'utf8');
    appendFileSync('.env', `${env.endsWith('\n') ? '' : '\n'}TON_PAYER_MNEMONIC="${words.join(' ')}"\n`);
    process.env.TON_PAYER_MNEMONIC = words.join(' ');
    console.log(`payer address (testnet): ${friendly((await wallet()).contract.address)}`);
    return;
  }
  const w = await wallet();
  if (cmd === 'address') return console.log(friendly(w.contract.address));
  if (cmd === 'balance') return console.log(`${fromNano(await retry(() => w.opened.getBalance()))} TON`);
  if (cmd === 'pay') {
    const [to, amount, comment] = args;
    if (!to || !amount || !comment) throw new Error('usage: pay <to> <amountTon> <comment>');
    const seqno = await retry(() => w.opened.getSeqno());
    await retry(() =>
      w.opened.sendTransfer({
        seqno,
        // fees on top, so the receiver gets the exact amount the server checks for
        sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
        secretKey: w.key.secretKey,
        messages: [internal({ to: Address.parse(to), value: toNano(amount), body: comment, bounce: false })],
      }),
    );
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      if ((await retry(() => w.opened.getSeqno())) > seqno) {
        const [tx] = await retry(() => client.getTransactions(w.contract.address, { limit: 1 }));
        console.log(`sent ${amount} TON to ${to} with comment "${comment}"`);
        console.log(`payer tx: ${tx.hash().toString('hex')}`);
        return;
      }
    }
    throw new Error('transfer not confirmed after 2 minutes');
  }
  throw new Error('usage: new | address | balance | pay <to> <amountTon> <comment>');
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});

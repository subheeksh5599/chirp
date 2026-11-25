// Telegram bot: pairing, the daily /heard log, contacts, paper positions, and on-chain checks.
import { one, q } from './db.js';
import { env } from './env.js';
import { devicesOfUser, pairDevice } from './devices.js';
import { notify } from './notify.js';
import { checkPayment } from './handoff.js';
import { paperPositions } from './markers.js';
import { ANCHOR_NANO } from './sessions.js';
import { displayName, esc, tg, TgUser } from './telegram.js';
import { explorerTx, findPayment, nanoToTon } from './ton.js';

type Update = {
  message?: { chat: { id: number; type: string }; from?: TgUser; text?: string };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number } } };
};

const HELP = [
  '<b>Chirp</b> lets nearby phones, laptops and speakers send things to your glasses with a short sound.',
  '',
  '1. Open Chirp on your glasses. It shows a 6-digit code.',
  '2. Send that code here.',
  '',
  '/heard — what your glasses caught today',
  '/met — people you connected with',
  '/paper — paper positions (no real money)',
  '',
  'To share your own card, tap <b>Chirp me</b> below the message box.',
].join('\n');

const time = (iso: string) => new Date(iso).toISOString().slice(11, 16) + ' UTC';

async function heardToday(userId: number) {
  const devices = await devicesOfUser(userId);
  if (!devices.length) return 'No glasses paired yet. Send the 6-digit code shown on your lens.';
  const rows = await q<{ kind: string; title: string; heard_at: string }>(
    `SELECT kind, title, heard_at FROM $S.heard_log WHERE device_id = ANY($1::uuid[]) AND heard_at > now() - interval '24 hours'
     ORDER BY heard_at DESC LIMIT 30`,
    [devices.map((d) => d.id)],
  );
  if (!rows.length) return 'Nothing heard in the last 24 hours.';
  const icon: Record<string, string> = { talk: '🎤', contact: '👋', bill: '🧾', market: '📈' };
  return ['<b>Heard in the last 24 hours</b>', ...rows.map((r) => `${time(r.heard_at)} ${icon[r.kind] ?? '•'} ${esc(r.title)}`)].join('\n');
}

async function met(userId: number) {
  const devices = await devicesOfUser(userId);
  const rows = devices.length
    ? await q<{ other_name: string; other_username: string | null; role: string | null; met_at: string }>(
        `SELECT other_name, other_username, role, met_at FROM $S.contacts WHERE device_id = ANY($1::uuid[]) ORDER BY met_at DESC LIMIT 30`,
        [devices.map((d) => d.id)],
      )
    : [];
  if (!rows.length) return 'No contacts yet.';
  return [
    '<b>People you met</b>',
    ...rows.map(
      (r) => `${new Date(r.met_at).toISOString().slice(0, 10)} · ${esc(r.other_name)}${r.role ? ` · ${esc(r.role)}` : ''}${r.other_username ? ` · @${esc(r.other_username)}` : ''}`,
    ),
  ].join('\n');
}

async function paper(userId: number) {
  const devices = await devicesOfUser(userId);
  const rows = await paperPositions(devices.map((d) => d.id));
  if (!rows.length) return 'No paper positions. Double-tap a market card on your glasses to open one.';
  return [
    '<b>Paper positions</b> (no real money)',
    ...rows.map(
      (r) =>
        `YES ${esc(r.question)}\n  in ${Math.round(r.entry * 100)}% → now ${r.now === null ? '?' : `${Math.round(r.now * 100)}%`} · ${
          r.pnl === null ? 'price unavailable' : `${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}`
        }`,
    ),
  ].join('\n');
}

async function checkAnchor(presenceId: string) {
  const p = await one<{ id: string; anchor_tx: string | null }>(`SELECT id, anchor_tx FROM $S.presence WHERE id = $1`, [presenceId]);
  if (!p) return 'Record not found.';
  if (p.anchor_tx) return `Already anchored: ${explorerTx(p.anchor_tx)}`;
  const tx = await findPayment(`chirp:presence:${presenceId}`, ANCHOR_NANO);
  if (!tx) return `Not on testnet yet. It can take a few seconds after you confirm (${nanoToTon(ANCHOR_NANO)} TON with the comment chirp:presence:${presenceId}).`;
  await q(`UPDATE $S.presence SET anchor_tx = $2, anchored_at = now() WHERE id = $1`, [presenceId, tx.hash]);
  return `✓ Anchored on TON testnet: ${explorerTx(tx.hash)}`;
}

export async function handleUpdate(u: Update) {
  if (u.callback_query) {
    const cq = u.callback_query;
    const chat = cq.message?.chat.id ?? cq.from.id;
    const [kind, id] = (cq.data ?? '').split(':');
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Checking testnet…' }).catch(() => undefined);
    if (kind === 'anchor' && id) await notify(chat, await checkAnchor(id));
    if (kind === 'pay' && id) {
      const r = await checkPayment(id);
      await notify(chat, r.paid ? `✓ Paid ${r.amountTon} TON to ${esc(r.shop)} · ${r.tx}` : 'Payment not seen on testnet yet. Try again in a few seconds.');
    }
    return;
  }
  const m = u.message;
  if (!m?.text || !m.from || m.chat.type !== 'private') return;
  const text = m.text.trim();
  const [cmd, arg] = text.split(/\s+/, 2);
  const code = /^\d{6}$/.test(text) ? text : cmd === '/start' || cmd === '/pair' ? arg : undefined;
  if (code && /^\d{6}$/.test(code)) {
    const d = await pairDevice(code, { id: m.from.id, name: displayName(m.from), username: m.from.username });
    await notify(m.chat.id, d ? '✓ Paired. Your glasses are linked to this chat.' : 'That code is not valid. Check the number on your lens.');
    return;
  }
  if (cmd === '/heard') return void (await notify(m.chat.id, await heardToday(m.from.id)));
  if (cmd === '/met') return void (await notify(m.chat.id, await met(m.from.id)));
  if (cmd === '/paper') return void (await notify(m.chat.id, await paper(m.from.id)));
  await notify(m.chat.id, HELP, [[{ text: 'Chirp me', web_app: { url: `${env.publicUrl}/mini.html` } }]]);
}

/** One-time bot setup: webhook, command list and the Mini App menu button. */
export async function setupBot() {
  await tg('setWebhook', {
    url: `${env.publicUrl}/api/telegram`,
    secret_token: env.webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await tg('setMyCommands', {
    commands: [
      { command: 'heard', description: 'What your glasses caught today' },
      { command: 'met', description: 'People you connected with' },
      { command: 'paper', description: 'Paper positions (no real money)' },
      { command: 'help', description: 'How Chirp works' },
    ],
  });
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Chirp me', web_app: { url: `${env.publicUrl}/mini.html` } } });
  return tg('getWebhookInfo', {});
}

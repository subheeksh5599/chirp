import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, HttpError } from './env.js';

type Button = { text: string; url?: string; callback_data?: string; web_app?: { url: string } };

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${env.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok: boolean; result: T; description?: string };
  if (!j.ok) throw new HttpError(502, `telegram ${method} failed: ${j.description ?? r.status}`);
  return j.result;
}

let botName: Promise<string> | null = null;
/** The bot's @username, read from Telegram with the configured token (cached per process). */
export function botUsername(): Promise<string> {
  botName ??= tg<{ username: string }>('getMe', {}).then((u) => u.username).catch((e) => {
    botName = null;
    throw e;
  });
  return botName;
}

export function send(chatId: number | string, text: string, buttons?: Button[][]) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type TgUser = { id: number; first_name: string; last_name?: string; username?: string };

export const displayName = (u: Pick<TgUser, 'first_name' | 'last_name'>) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ');

/**
 * Validate Telegram Mini App initData (HMAC with key derived from the bot token).
 * Returns the user, or throws 401. `maxAgeS` rejects stale launches.
 */
export function verifyInitData(initData: string, botToken = env.botToken, maxAgeS = 24 * 3600, nowS = Date.now() / 1000): TgUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new HttpError(401, 'initData has no hash');
  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'initData signature is invalid');
  }
  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowS - authDate > maxAgeS) throw new HttpError(401, 'initData is too old');
  const user = JSON.parse(params.get('user') ?? 'null') as TgUser | null;
  if (!user?.id) throw new HttpError(401, 'initData has no user');
  return user;
}

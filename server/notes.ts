// Voice notes: after connecting, the wearer holds, speaks, and taps to send it to the other person.
// The speech becomes a draft first; nothing is sent until the wearer confirms the words on the lens.
import { randomCode } from '../packages/wire/src/index.js';
import { one, q } from './db.js';
import { Device, requirePaired } from './devices.js';
import { HttpError } from './env.js';
import { transcribe } from './groq.js';
import { Card, errorCard, infoCard, wrap } from './lens.js';
import { notify } from './notify.js';
import { esc } from './telegram.js';

/** 16 kHz mono 16-bit WAV: 0.5 s is the shortest note worth sending, 15 s the longest. */
export const NOTE_MIN_BYTES = 44 + 16_000;
export const NOTE_MAX_BYTES = 44 + 16_000 * 2 * 15;

type Contact = { id: string; other_tg_id: string; other_name: string };

async function myContact(device: Device, id: string): Promise<Contact> {
  const c = await one<Contact>(
    `SELECT id, other_tg_id, other_name FROM $S.contacts WHERE id = $1 AND owner_tg_id = $2`,
    [id, device.tg_user_id],
  );
  if (!c) throw new HttpError(404, 'contact not found');
  return c;
}

/** The card shown right after connecting: holding the touchpad records a note to this person. */
export function connectedCard(contactId: string, name: string): Card {
  return {
    kind: 'connected',
    ref: { type: 'contact', id: contactId },
    lines: [`Connected with ${name}`, 'both of you got a message'],
    voice: `note to ${name}`,
  };
}

/** Speech in, a draft on the lens out. */
export async function draftNote(device: Device, ref: { type?: string; id?: string } | undefined, audioB64: unknown): Promise<Card> {
  requirePaired(device);
  if (ref?.type !== 'contact' || typeof ref.id !== 'string' || !/^\d+$/.test(ref.id)) throw new HttpError(400, 'a contact ref is required');
  if (typeof audioB64 !== 'string') throw new HttpError(400, 'audio (base64 WAV) is required');
  const wav = Buffer.from(audioB64, 'base64');
  if (wav.length > NOTE_MAX_BYTES) throw new HttpError(413, 'notes are up to 15 seconds');
  const c = await myContact(device, ref.id);
  // A miss keeps the contact on the card, so holding again simply retries.
  const retry = (): Card => ({ ...errorCard("Didn't catch that", 'hold, speak, then let go'), ref: { type: 'contact', id: c.id }, voice: `note to ${c.other_name}` });
  if (wav.length < NOTE_MIN_BYTES) return retry();
  const text = (await transcribe(wav, 'audio/wav')).slice(0, 300);
  if (!text) return retry();
  const id = randomCode(8);
  await q(`INSERT INTO $S.notes (id, contact_id, text) VALUES ($1, $2, $3)`, [id, c.id, text]);
  return {
    kind: 'draft',
    ref: { type: 'note', id },
    lines: [`To ${c.other_name}:`, ...wrap(`"${text}"`, 40, 3)],
    tap: 'send',
    double: 'discard',
  };
}

/** Tap sends the draft to the other person's Telegram; double-tap throws it away. */
export async function actOnNote(device: Device & { tg_user_id: string }, id: string, action: 'tap' | 'double'): Promise<Card> {
  const n = await one<{ id: string; text: string; sent_at: string | null; other_tg_id: string; other_name: string; owner_tg_id: string }>(
    `SELECT n.id, n.text, n.sent_at, c.other_tg_id, c.other_name, c.owner_tg_id
       FROM $S.notes n JOIN $S.contacts c ON c.id = n.contact_id WHERE n.id = $1`,
    [id],
  );
  if (!n || String(n.owner_tg_id) !== String(device.tg_user_id)) throw new HttpError(404, 'note not found');
  if (n.sent_at) return infoCard(`Already sent to ${n.other_name}`);
  if (action === 'double') {
    await q(`DELETE FROM $S.notes WHERE id = $1`, [id]);
    return infoCard('Note discarded');
  }
  const sent = await one<{ id: string }>(`UPDATE $S.notes SET sent_at = now() WHERE id = $1 AND sent_at IS NULL RETURNING id`, [id]);
  if (!sent) return infoCard(`Already sent to ${n.other_name}`);
  const me = device.tg_name ?? 'Someone';
  await notify(
    n.other_tg_id,
    `💬 <b>${esc(me)}</b>${device.tg_username ? ` (@${esc(device.tg_username)})` : ''} via Chirp:\n${esc(n.text)}`,
    device.tg_username ? [[{ text: `Reply to ${me}`, url: `https://t.me/${device.tg_username}` }]] : undefined,
  );
  return infoCard(`Sent to ${n.other_name}`, ...wrap(`"${n.text}"`, 40, 2));
}

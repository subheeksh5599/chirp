// Broadcast sessions (a talk, class or meetup) and presence records.
import {
  DEFAULT_RULE,
  codeForSlot,
  encodeFrame,
  evaluatePresence,
  hexToBytes,
  matchSlot,
  randomCode,
  slotOf,
} from '../packages/wire/src/index.js';
import { one, q } from './db.js';
import { env, HttpError } from './env.js';
import { randomHex, safeEqualHex, sha256, signRecord } from './crypto.js';
import { Card, infoCard, wrap } from './lens.js';
import { Device, logHeard } from './devices.js';
import { notify } from './notify.js';
import { esc } from './telegram.js';
import { transferLink, tonToNano } from './ton.js';

export type Poll = { question: string; a: string; b: string };
export type Slide = { title: string; note?: string; poll?: Poll };

export type Session = {
  id: string;
  title: string;
  admin_hash: string;
  key_hex: string;
  slides: Slide[];
  deck_url: string | null;
  channel_url: string | null;
  current_slide: number;
  rule_min_codes: number;
  rule_min_minutes: number;
  caption: string | null;
  caption_at: string | null;
  created_at: string;
  ended_at: string | null;
};

const MAX_SLIDES = 100;
const str = (v: unknown, max: number, field: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${field} is longer than ${max} characters`);
  if (required && !s) throw new HttpError(400, `${field} is required`);
  return s || undefined;
};
const url = (v: unknown, field: string) => {
  const s = str(v, 500, field);
  if (!s) return undefined;
  if (!/^https:\/\//.test(s)) throw new HttpError(400, `${field} must start with https://`);
  return s;
};

export function parseSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'slides must be a non-empty list');
  if (raw.length > MAX_SLIDES) throw new HttpError(400, `at most ${MAX_SLIDES} slides`);
  return raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const slide: Slide = { title: str(o.title, 120, `slide ${i + 1} title`, true)! };
    const note = str(o.note, 200, `slide ${i + 1} note`);
    if (note) slide.note = note;
    if (o.poll) {
      const p = o.poll as Record<string, unknown>;
      slide.poll = {
        question: str(p.question, 120, `slide ${i + 1} poll question`, true)!,
        a: str(p.a, 24, `slide ${i + 1} option A`, true)!,
        b: str(p.b, 24, `slide ${i + 1} option B`, true)!,
      };
    }
    return slide;
  });
}

export async function createSession(body: Record<string, unknown>) {
  const title = str(body.title, 80, 'title', true)!;
  const slides = parseSlides(body.slides);
  const rule = (body.rule ?? {}) as Record<string, unknown>;
  const minCodes = Number(rule.minCodes ?? DEFAULT_RULE.minCodes);
  const minMinutes = Number(rule.minMinutes ?? DEFAULT_RULE.minMinutes);
  if (!Number.isInteger(minCodes) || minCodes < 2 || minCodes > 100) throw new HttpError(400, 'minCodes must be 2–100');
  if (!Number.isInteger(minMinutes) || minMinutes < 1 || minMinutes > 600) throw new HttpError(400, 'minMinutes must be 1–600');
  const id = randomCode(8);
  const adminSecret = randomHex(24);
  await q(
    `INSERT INTO $S.sessions (id, title, admin_hash, key_hex, slides, deck_url, channel_url, rule_min_codes, rule_min_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, title, sha256(adminSecret), randomHex(32), JSON.stringify(slides), url(body.deckUrl, 'deckUrl') ?? null,
      url(body.channelUrl, 'channelUrl') ?? null, minCodes, minMinutes],
  );
  return { id, adminSecret };
}

export async function getSession(id: string): Promise<Session> {
  const s = await one<Session>(`SELECT * FROM $S.sessions WHERE id = $1`, [id]);
  if (!s) throw new HttpError(404, 'session not found');
  return s;
}

export async function adminSession(id: string, header: string | undefined): Promise<Session> {
  const s = await getSession(id);
  const m = /^Bearer ([0-9a-f]{48})$/i.exec(header ?? '');
  if (!m || !safeEqualHex(s.admin_hash, sha256(m[1]))) throw new HttpError(401, 'not the session owner');
  return s;
}

/** Current frame for the console to chirp. Codes never leave the server except this way. */
export async function currentFrame(s: Session, nowMs = Date.now()) {
  if (s.ended_at) throw new HttpError(409, 'session has ended');
  const slot = slotOf(nowMs);
  const code = await codeForSlot(hexToBytes(s.key_hex), slot);
  return { frame: encodeFrame({ type: 'B', code }), slot, validForMs: (slot + 1) * 5000 - nowMs };
}

export async function setSlide(s: Session, index: unknown) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= s.slides.length) throw new HttpError(400, 'slide index out of range');
  await q(`UPDATE $S.sessions SET current_slide = $2 WHERE id = $1`, [s.id, i]);
}

export async function endSession(s: Session) {
  await q(`UPDATE $S.sessions SET ended_at = coalesce(ended_at, now()) WHERE id = $1`, [s.id]);
}

export async function setCaption(s: Session, text: string) {
  await q(`UPDATE $S.sessions SET caption = $2, caption_at = now() WHERE id = $1`, [s.id, text.slice(0, 300)]);
}

/** Find which live session a heard broadcast code belongs to (and its slot). */
export async function matchBroadcast(code: string, nowMs = Date.now()) {
  const live = await q<Session>(
    `SELECT * FROM $S.sessions WHERE ended_at IS NULL AND created_at > now() - interval '24 hours'`,
  );
  for (const s of live) {
    const slot = await matchSlot(hexToBytes(s.key_hex), code, nowMs);
    if (slot !== null) return { session: s, slot };
  }
  return null;
}

export async function recordHearing(device: Device, s: Session, slot: number) {
  await q(
    `INSERT INTO $S.hearings (device_id, session_id, slot) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [device.id, s.id, slot],
  );
  await logHeard(device.id, 'talk', s.id, s.title, { deck: s.deck_url, channel: s.channel_url });
}

async function slotsHeard(deviceId: string, sessionId: string): Promise<number[]> {
  const rows = await q<{ slot: string }>(
    `SELECT slot FROM $S.hearings WHERE device_id = $1 AND session_id = $2 ORDER BY slot`,
    [deviceId, sessionId],
  );
  return rows.map((r) => Number(r.slot));
}

export async function hasJoined(deviceId: string, sessionId: string) {
  return !!(await one(`SELECT 1 FROM $S.hearings WHERE device_id = $1 AND session_id = $2 LIMIT 1`, [deviceId, sessionId]));
}

export async function presenceStatus(deviceId: string, s: Session) {
  const slots = await slotsHeard(deviceId, s.id);
  const result = evaluatePresence(slots, { minCodes: s.rule_min_codes, minMinutes: s.rule_min_minutes });
  const claimed = await one<{ id: string }>(`SELECT id FROM $S.presence WHERE session_id = $1 AND device_id = $2`, [s.id, deviceId]);
  return { ...result, slots, claimedId: claimed?.id ?? null };
}

async function myVote(sessionId: string, slide: number, deviceId: string) {
  const v = await one<{ choice: number }>(
    `SELECT choice FROM $S.votes WHERE session_id = $1 AND slide = $2 AND device_id = $3`,
    [sessionId, slide, deviceId],
  );
  return v ? v.choice : null;
}

export async function tally(sessionId: string, slide: number) {
  const rows = await q<{ choice: number; n: string }>(
    `SELECT choice, count(*) AS n FROM $S.votes WHERE session_id = $1 AND slide = $2 GROUP BY choice`,
    [sessionId, slide],
  );
  const a = Number(rows.find((r) => r.choice === 0)?.n ?? 0);
  const b = Number(rows.find((r) => r.choice === 1)?.n ?? 0);
  return { a, b, total: a + b };
}

const share = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '–');

/** The lens card for a joined device: current slide, live poll, subtitles, or the claim at the end. */
export async function sessionCard(device: Device, s: Session): Promise<Card> {
  const ref = { type: 'session' as const, id: s.id };
  if (s.ended_at) {
    const p = await presenceStatus(device.id, s);
    if (p.claimedId) return { kind: 'presence', ref: { type: 'presence', id: s.id }, lines: [`✓ Presence claimed`, s.title, 'record is in your Telegram'] };
    if (p.ok) {
      return {
        kind: 'presence',
        ref: { type: 'presence', id: s.id },
        lines: [`✓ You were here · ${Math.round(p.spanMinutes)} min`, s.title, `${p.codes} room codes heard`],
        tap: 'claim',
      };
    }
    return infoCard('Session ended', s.title, p.reason ?? 'not enough time in the room');
  }
  const i = s.current_slide;
  const slide = s.slides[i];
  const header = `${s.title} · ${i + 1}/${s.slides.length}`;
  const fresh = s.caption && s.caption_at && Date.now() - Date.parse(s.caption_at) < 20_000;
  const caption = fresh ? wrap(`“${s.caption}”`, 40, 1) : [];
  if (slide.poll) {
    const mine = await myVote(s.id, i, device.id);
    if (mine !== null) {
      const t = await tally(s.id, i);
      return {
        kind: 'poll', ref, live: true,
        lines: [header, ...wrap(slide.poll.question, 40, 2), `You: ${mine === 0 ? slide.poll.a : slide.poll.b} · ${slide.poll.a} ${share(t.a, t.total)} · ${slide.poll.b} ${share(t.b, t.total)}`],
      };
    }
    return {
      kind: 'poll', ref, live: true,
      lines: [header, ...wrap(`Poll · ${slide.poll.question}`, 40, 2), ...caption],
      tap: slide.poll.a,
      double: slide.poll.b,
    };
  }
  return {
    kind: 'slide', ref, live: true,
    lines: [header, ...wrap(slide.title, 40, 2), ...(slide.note ? wrap(slide.note, 40, 1) : []), ...caption],
    tap: s.deck_url || s.channel_url ? 'save links' : undefined,
  };
}

export async function vote(device: Device, s: Session, choice: 0 | 1) {
  const slide = s.slides[s.current_slide];
  if (!slide.poll) throw new HttpError(409, 'this slide has no poll');
  if (s.ended_at) throw new HttpError(409, 'session has ended');
  if (!(await hasJoined(device.id, s.id))) throw new HttpError(403, 'hear the room first');
  await q(
    `INSERT INTO $S.votes (session_id, slide, device_id, choice) VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, slide, device_id) DO UPDATE SET choice = $4, voted_at = now()`,
    [s.id, s.current_slide, device.id, choice],
  );
}

export async function saveLinks(device: Device & { tg_user_id: string }, s: Session) {
  const slide = s.slides[s.current_slide];
  const lines = [`<b>${esc(s.title)}</b>`, `Slide ${s.current_slide + 1}: ${esc(slide.title)}`];
  if (s.deck_url) lines.push(`Deck: ${esc(s.deck_url)}`);
  if (s.channel_url) lines.push(`Channel: ${esc(s.channel_url)}`);
  const buttons = [
    ...(s.deck_url ? [[{ text: 'Open deck', url: s.deck_url }]] : []),
    ...(s.channel_url ? [[{ text: 'Join channel', url: s.channel_url }]] : []),
  ];
  await notify(device.tg_user_id, lines.join('\n'), buttons.length ? buttons : undefined);
}

export const ANCHOR_NANO = tonToNano(0.01);

export async function claimPresence(device: Device & { tg_user_id: string }, s: Session) {
  const p = await presenceStatus(device.id, s);
  if (p.claimedId) throw new HttpError(409, 'already claimed');
  if (!p.ok) throw new HttpError(403, p.reason ?? 'not present long enough');
  const times = await one<{ first: string; last: string }>(
    `SELECT min(heard_at) AS first, max(heard_at) AS last FROM $S.hearings WHERE device_id = $1 AND session_id = $2`,
    [device.id, s.id],
  );
  const id = randomCode(8);
  const record = {
    v: 1,
    type: 'chirp.presence',
    id,
    session: s.id,
    title: s.title,
    // Pseudonymous holder: stable per person and session, reveals nothing on its own.
    holder: sha256(`${device.tg_user_id}:${s.id}`).slice(0, 16),
    from: new Date(times!.first).toISOString(),
    to: new Date(times!.last).toISOString(),
    codes: p.codes,
    minutes: Math.round(p.spanMinutes),
    issuedAt: new Date().toISOString(),
  };
  const signature = signRecord(record);
  await q(`INSERT INTO $S.presence (id, session_id, device_id, record, signature) VALUES ($1, $2, $3, $4, $5)`, [
    id, s.id, device.id, JSON.stringify(record), signature,
  ]);
  const comment = `chirp:presence:${id}`;
  await notify(
    device.tg_user_id,
    [
      `✓ <b>Presence record</b> · ${esc(s.title)}`,
      `${record.minutes} min in the room · ${record.codes} codes heard`,
      `Signed record: ${esc(env.publicUrl)}/api/presence/${id}`,
      '',
      'Optional: anchor it on TON testnet (0.01 TON, confirmed in your wallet).',
    ].join('\n'),
    [
      [{ text: 'Anchor on TON testnet', url: transferLink(env.tonAddress, ANCHOR_NANO, comment) }],
      [{ text: 'I sent it, check', callback_data: `anchor:${id}` }],
    ],
  );
  return { id, record, signature };
}

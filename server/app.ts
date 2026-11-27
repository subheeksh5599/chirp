// The two calls the glasses make: "I heard this" and "the wearer tapped".
import { parseFrame } from '../packages/wire/src/index.js';
import { q, one } from './db.js';
import { HttpError } from './env.js';
import { Card, Ref, errorCard, infoCard } from './lens.js';
import { Device, requirePaired } from './devices.js';
import {
  claimPresence,
  getSession,
  hasJoined,
  matchBroadcast,
  recordHearing,
  saveLinks,
  sessionCard,
  vote,
} from './sessions.js';
import { claimHandoff, connect, handoffCard, liveHandoff, releaseHandoff, saveLink, sendPayLink, singleUse } from './handoff.js';
import { liveMarker, markerCard, paperYes, saveMarket } from './markers.js';
import { actOnNote, connectedCard } from './notes.js';
import { recentRoom, saveSuggestions, suggestMessages } from './suggest.js';

/** Resolves a device may ask for per minute. A talk chirps every 20 s and a hand-off twice, so 30 is generous. */
export const RESOLVES_PER_MINUTE = 30;

/** The fixed code the sound-test page and the home page play (`HTEST0000`). */
export const SOUND_TEST_CODE = 'TEST0000';

export type Outcome = 'ok' | 'sound-test' | 'not-a-code' | 'room-code-rejected' | 'card-expired' | 'card-used' | 'marker-expired';

/** What the glasses app reports about the hardware that heard a chirp. Anything else is stored as 'unknown'. */
export type Hearing = { model?: unknown; mic?: unknown };
const MODELS = ['g1', 'g2', 'simulator', 'none'];
const MICS = ['glasses', 'phone'];
const pick = (v: unknown, allowed: string[]) => (typeof v === 'string' && allowed.includes(v) ? v : 'unknown');

export async function heard(device: Device, text: unknown, nowMs = Date.now(), hw: Hearing = {}): Promise<Card> {
  if (!device.tg_user_id) return errorCard('Not paired yet', 'open the Chirp bot in Telegram', 'and send your pairing code');
  if (typeof text !== 'string') throw new HttpError(400, 'frame text is required');
  const recent = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM $S.resolves WHERE device_id = $1 AND at > now() - interval '1 minute'`,
    [device.id],
  );
  if ((recent?.n ?? 0) >= RESOLVES_PER_MINUTE) throw new HttpError(429, 'too many chirps from this device; wait a minute');
  const [card, outcome] = await resolve(device, text, nowMs);
  await q(`INSERT INTO $S.resolves (device_id, frame, outcome, model, mic) VALUES ($1, $2, $3, $4, $5)`, [
    device.id,
    text.slice(0, 32),
    outcome,
    pick(hw.model, MODELS),
    pick(hw.mic, MICS),
  ]);
  return card;
}

async function resolve(device: Device, text: string, nowMs: number): Promise<[Card, Outcome]> {
  const f = parseFrame(text);
  if (!f) return [errorCard('Heard a chirp', 'but it is not a Chirp code'), 'not-a-code'];
  if (f.type === 'B') {
    const hit = await matchBroadcast(f.code, nowMs);
    if (!hit) return [errorCard('Room code expired', 'wait for the next chirp'), 'room-code-rejected'];
    await recordHearing(device, hit.session, hit.slot);
    return [await sessionCard(device, hit.session), 'ok'];
  }
  if (f.type === 'H' && f.code === SOUND_TEST_CODE) {
    return [infoCard('Sound test heard', 'these glasses can hear that speaker'), 'sound-test'];
  }
  if (f.type === 'H') {
    const h = await liveHandoff(f.code);
    if (!h) return [errorCard('Card expired', 'ask them to chirp again'), 'card-expired'];
    if (singleUse(h) && h.used_at) return [usedCard(device, h), 'card-used'];
    return [await handoffCard(device, h), 'ok'];
  }
  const m = await liveMarker(f.code);
  if (!m) return [errorCard('Marker expired'), 'marker-expired'];
  return [await markerCard(device, m.token, m.market_id), 'ok'];
}

/** Polling while a session card is on the lens: slide changes, polls, subtitles, the end. */
export async function sessionState(device: Device, sessionId: string): Promise<Card> {
  const s = await getSession(sessionId);
  if (!(await hasJoined(device.id, s.id))) throw new HttpError(403, 'hear the room first');
  return sessionCard(device, s);
}

export async function act(device: Device, ref: Ref | undefined, action: unknown): Promise<Card> {
  requirePaired(device);
  if (action !== 'tap' && action !== 'double') throw new HttpError(400, 'action must be tap or double');
  if (!ref || typeof ref.id !== 'string') throw new HttpError(400, 'ref is required');
  switch (ref.type) {
    case 'session': {
      const s = await getSession(ref.id);
      const slide = s.slides[s.current_slide];
      if (slide.poll && !s.ended_at) {
        await vote(device, s, action === 'tap' ? 0 : 1);
        return sessionCard(device, s);
      }
      if (action === 'tap') {
        await saveLinks(device, s);
        return { ...(await sessionCard(device, s)), lines: ['Links sent to Telegram', s.title] };
      }
      return sessionCard(device, s);
    }
    case 'presence': {
      if (action !== 'tap') return infoCard('Claim later', 'it stays available');
      const s = await getSession(ref.id);
      await claimPresence(device, s);
      return { kind: 'presence', lines: ['Presence claimed', s.title, 'signed record sent to Telegram'] };
    }
    case 'handoff': {
      const h = await liveHandoff(ref.id);
      if (!h) return errorCard('Card expired', 'ask them to chirp again');
      if (action === 'double') return infoCard('Ignored');
      if (h.kind === 'link') {
        await saveLink(device, h);
        return infoCard('Saved to Telegram', h.payload.title);
      }
      // Your own card is refused before claiming, so tapping it never burns the code for the person you meet.
      if (h.kind === 'connect' && String(h.owner_tg_id) === String(device.tg_user_id)) throw new HttpError(409, 'that is your own card');
      if (!(await claimHandoff(h.token, device.id))) return usedCard(device, (await liveHandoff(h.token)) ?? h);
      try {
        if (h.kind === 'connect') {
          const contactId = await connect(device, h);
          const texts = await suggestMessages({
            theirName: h.payload.name,
            theirRole: h.payload.role,
            myName: device.tg_name,
            where: await recentRoom(device.id),
          });
          const ids = await saveSuggestions(contactId, texts);
          return connectedCard(contactId, h.payload.name, ids.map((id, i) => ({ id, text: texts[i] })));
        }
        await sendPayLink(device, h);
        return infoCard('Payment link sent', 'confirm it in your wallet', 'on your phone');
      } catch (e) {
        await releaseHandoff(h.token, device.id);
        throw e;
      }
    }
    case 'note':
      return actOnNote(device, ref.id, action);
    case 'marker': {
      const m = await liveMarker(ref.id);
      if (!m) return errorCard('Marker expired');
      if (action === 'tap') {
        await saveMarket(device, m.market_id);
        return infoCard('Market saved to Telegram');
      }
      const market = await paperYes(device, m.market_id);
      return infoCard(`Paper YES at ${Math.round(market.yes * 100)}%`, 'no real money · see /paper');
    }
    default:
      throw new HttpError(400, 'unknown ref type');
  }
}

/** Public, anonymous tally of chirps heard, by hardware and mic: the first real-G2 hearing shows up here. */
export async function hearingTally() {
  const rows = await q<{ model: string; mic: string; heard: number; decoded: number; first_at: string; last_at: string }>(
    `SELECT coalesce(model, 'unknown') AS model, coalesce(mic, 'unknown') AS mic, count(*)::int AS heard,
            count(*) FILTER (WHERE outcome IN ('ok', 'sound-test'))::int AS decoded,
            min(at) AS first_at, max(at) AS last_at
       FROM $S.resolves GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return {
    note: 'model is what the glasses app reports from the Even Hub SDK: g2 = real glasses, simulator = the official simulator (it reports a G2 with a fixed placeholder serial), none = no device reported. decoded = chirps that resolved to a Chirp card or the sound test. unknown = hearings from before hardware tracking started (2026-11-27).',
    rows,
  };
}

/** A single-use card someone already tapped. The device that claimed it is told it is done; anyone else, that it is gone. */
function usedCard(device: Device, h: { kind: string; used_by: string | null; payload: { name?: string } }): Card {
  if (h.used_by === device.id) return h.kind === 'connect' ? infoCard(`Already connected with ${h.payload.name}`) : infoCard('Payment link already sent', 'check your Telegram');
  return errorCard('Card already used', 'ask them to chirp again');
}

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
import { connect, handoffCard, liveHandoff, saveLink, sendPayLink } from './handoff.js';
import { liveMarker, markerCard, paperYes, saveMarket } from './markers.js';
import { actOnNote, connectedCard } from './notes.js';

/** Resolves a device may ask for per minute. A talk chirps every 20 s and a hand-off twice, so 30 is generous. */
export const RESOLVES_PER_MINUTE = 30;

/** The fixed code the sound-test page and the home page play (`HTEST0000`). */
export const SOUND_TEST_CODE = 'TEST0000';

export type Outcome = 'ok' | 'sound-test' | 'not-a-code' | 'room-code-rejected' | 'card-expired' | 'marker-expired';

/** What the glasses app reports about the hardware that heard a chirp. Anything else is stored as 'unknown'. */
export type Hearing = { model?: unknown; mic?: unknown };
const MODELS = ['g1', 'g2', 'none'];
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
      if (h.kind === 'connect') return connectedCard(await connect(device, h), h.payload.name);
      await sendPayLink(device, h);
      return infoCard('Payment link sent', 'confirm it in your wallet', 'on your phone');
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
    note: 'model is what the Even Hub SDK reports (g2 = real glasses; none = the simulator, which has no device). decoded = chirps that resolved to a Chirp card or the sound test.',
    rows,
  };
}

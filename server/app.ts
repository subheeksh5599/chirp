// The two calls the glasses make: "I heard this" and "the wearer tapped".
import { parseFrame } from '../packages/wire/src/index.js';
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

export async function heard(device: Device, text: unknown, nowMs = Date.now()): Promise<Card> {
  if (!device.tg_user_id) return errorCard('Not paired yet', 'open the Chirp bot in Telegram', 'and send your pairing code');
  if (typeof text !== 'string') throw new HttpError(400, 'frame text is required');
  const f = parseFrame(text);
  if (!f) return errorCard('Heard a chirp', 'but it is not a Chirp code');
  if (f.type === 'B') {
    const hit = await matchBroadcast(f.code, nowMs);
    if (!hit) return errorCard('Room code expired', 'wait for the next chirp');
    await recordHearing(device, hit.session, hit.slot);
    return sessionCard(device, hit.session);
  }
  if (f.type === 'H') {
    const h = await liveHandoff(f.code);
    if (!h) return errorCard('Card expired', 'ask them to chirp again');
    return handoffCard(device, h);
  }
  const m = await liveMarker(f.code);
  if (!m) return errorCard('Marker expired');
  return markerCard(device, m.token, m.market_id);
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
        return { ...(await sessionCard(device, s)), lines: ['✓ Links sent to Telegram', s.title] };
      }
      return sessionCard(device, s);
    }
    case 'presence': {
      if (action !== 'tap') return infoCard('Claim later', 'it stays available');
      const s = await getSession(ref.id);
      await claimPresence(device, s);
      return { kind: 'presence', lines: ['✓ Presence claimed', s.title, 'signed record sent to Telegram'] };
    }
    case 'handoff': {
      const h = await liveHandoff(ref.id);
      if (!h) return errorCard('Card expired', 'ask them to chirp again');
      if (action === 'double') return infoCard('Ignored');
      if (h.kind === 'link') {
        await saveLink(device, h);
        return infoCard('✓ Saved to Telegram', h.payload.title);
      }
      if (h.kind === 'connect') {
        await connect(device, h);
        return infoCard(`✓ Connected with ${h.payload.name}`, 'both of you got a message');
      }
      await sendPayLink(device, h);
      return infoCard('✓ Payment link sent', 'confirm it in your wallet', 'on your phone');
    }
    case 'marker': {
      const m = await liveMarker(ref.id);
      if (!m) return errorCard('Marker expired');
      if (action === 'tap') {
        await saveMarket(device, m.market_id);
        return infoCard('✓ Market saved to Telegram');
      }
      const market = await paperYes(device, m.market_id);
      return infoCard(`✓ Paper YES at ${Math.round(market.yes * 100)}%`, 'no real money · see /paper');
    }
    default:
      throw new HttpError(400, 'unknown ref type');
  }
}

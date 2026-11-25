import type { IncomingMessage, ServerResponse } from 'node:http';
import { botUsername } from './telegram.js';
import { HttpError, env } from './env.js';
import { render, type Card } from './lens.js';
import { createDevice, deviceFromAuth } from './devices.js';
import { act, heard, sessionState } from './app.js';
import {
  adminSession,
  createSession,
  currentFrame,
  endSession,
  setCaption,
  setSlide,
  tally,
  roomCard,
} from './sessions.js';
import { checkPayment, issueBill, issueConnect, issueLink } from './handoff.js';
import { createMarker } from './markers.js';
import { searchMarkets } from './polymarket.js';
import { handleUpdate } from './bot.js';
import { transcribe } from './groq.js';
import { one, q } from './db.js';
import { publicKeyBase64, verifyRecord } from './crypto.js';
import { explorerTx } from './ton.js';

export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: Record<string, unknown>;
};
export type Res = { status: number; body: unknown };

const ok = (body: unknown, status = 200): Res => ({ status, body });
const card = (c: Card) => ok({ card: c, text: render(c) });

type Handler = (req: Req, params: string[]) => Promise<Res>;
const routes: Array<[string, RegExp, Handler]> = [
  ['GET', /^\/api\/health$/, async () => ok({ ok: true, time: new Date().toISOString() })],
  ['GET', /^\/api\/config$/, async () => ok({ bot: await botUsername() })],

  ['POST', /^\/api\/devices$/, async () => ok(await createDevice(), 201)],
  ['GET', /^\/api\/devices\/me$/, async (r) => {
    const d = await deviceFromAuth(r.headers.authorization);
    return ok({ paired: !!d.tg_user_id, name: d.tg_name, username: d.tg_username, pairCode: d.pair_code });
  }],
  ['POST', /^\/api\/heard$/, async (r) => card(await heard(await deviceFromAuth(r.headers.authorization), r.body.frame))],
  ['POST', /^\/api\/act$/, async (r) =>
    card(await act(await deviceFromAuth(r.headers.authorization), r.body.ref as never, r.body.action))],

  ['POST', /^\/api\/sessions$/, async (r) => ok(await createSession(r.body), 201)],
  ['GET', /^\/api\/sessions\/([0-9A-Z]{8})\/state$/, async (r, [id]) =>
    card(await sessionState(await deviceFromAuth(r.headers.authorization), id))],
  ['GET', /^\/api\/sessions\/([0-9A-Z]{8})\/admin$/, async (r, [id]) => {
    const s = await adminSession(id, r.headers.authorization);
    const [stats] = await q<{ listeners: string; claims: string }>(
      `SELECT (SELECT count(DISTINCT device_id) FROM $S.hearings WHERE session_id = $1) AS listeners,
              (SELECT count(*) FROM $S.presence WHERE session_id = $1) AS claims`,
      [s.id],
    );
    return ok({
      id: s.id,
      title: s.title,
      slides: s.slides,
      currentSlide: s.current_slide,
      ended: !!s.ended_at,
      rule: { minCodes: s.rule_min_codes, minMinutes: s.rule_min_minutes },
      listeners: Number(stats.listeners),
      claims: Number(stats.claims),
      votes: await tally(s.id, s.current_slide),
      chirp: s.ended_at ? null : await currentFrame(s),
      lens: s.ended_at ? null : render(roomCard(s)),
      caption: s.caption,
    });
  }],
  ['POST', /^\/api\/sessions\/([0-9A-Z]{8})\/slide$/, async (r, [id]) => {
    await setSlide(await adminSession(id, r.headers.authorization), r.body.index);
    return ok({ ok: true });
  }],
  ['POST', /^\/api\/sessions\/([0-9A-Z]{8})\/end$/, async (r, [id]) => {
    await endSession(await adminSession(id, r.headers.authorization));
    return ok({ ok: true });
  }],
  ['POST', /^\/api\/sessions\/([0-9A-Z]{8})\/caption$/, async (r, [id]) => {
    const s = await adminSession(id, r.headers.authorization);
    if (typeof r.body.audio !== 'string') throw new HttpError(400, 'audio (base64) is required');
    const audio = Buffer.from(r.body.audio, 'base64');
    if (audio.length < 1000 || audio.length > 3_000_000) throw new HttpError(400, 'audio clip must be 1 KB – 3 MB');
    const text = await transcribe(audio, String(r.body.mime ?? 'audio/webm'), typeof r.body.language === 'string' ? r.body.language : undefined);
    if (text) await setCaption(s, text);
    return ok({ text });
  }],

  ['POST', /^\/api\/handoff\/connect$/, async (r) => ok(await issueConnect(r.body.initData, r.body.role), 201)],
  ['POST', /^\/api\/handoff\/bill$/, async (r) => ok(await issueBill(r.body), 201)],
  ['POST', /^\/api\/handoff\/link$/, async (r) => ok(await issueLink(r.body), 201)],
  ['GET', /^\/api\/pay\/([0-9A-Z]{8})$/, async (_r, [id]) => ok(await checkPayment(id))],

  ['GET', /^\/api\/markets$/, async (r) => {
    const query = (r.query.get('q') ?? '').trim();
    if (query.length < 2) throw new HttpError(400, 'search needs at least 2 characters');
    return ok({ markets: await searchMarkets(query.slice(0, 80)) });
  }],
  ['POST', /^\/api\/markers$/, async (r) => ok(await createMarker(r.body.marketId), 201)],

  ['GET', /^\/api\/presence\/([0-9A-Z]{8})$/, async (_r, [id]) => {
    const p = await one<{ record: object; signature: string; anchor_tx: string | null }>(
      `SELECT record, signature, anchor_tx FROM $S.presence WHERE id = $1`,
      [id],
    );
    if (!p) throw new HttpError(404, 'record not found');
    return ok({
      record: p.record,
      signature: p.signature,
      publicKey: publicKeyBase64(),
      signatureValid: verifyRecord(p.record, p.signature),
      anchor: p.anchor_tx ? { tx: p.anchor_tx, explorer: explorerTx(p.anchor_tx) } : null,
    });
  }],

  ['POST', /^\/api\/telegram$/, async (r) => {
    if (r.headers['x-telegram-bot-api-secret-token'] !== env.webhookSecret) throw new HttpError(401, 'bad webhook secret');
    await handleUpdate(r.body as never);
    return ok({ ok: true });
  }],
];

export async function route(req: Req): Promise<Res> {
  try {
    for (const [method, re, h] of routes) {
      const m = re.exec(req.path);
      if (m && method === req.method) return await h(req, m.slice(1));
    }
    return ok({ error: 'not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return ok({ error: e.message }, e.status);
    console.error(e);
    return ok({ error: 'internal error' }, 500);
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
};

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4_000_000) throw new HttpError(413, 'request body too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Node / Vercel adapter. */
export async function nodeHandler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://local');
  let out: Res;
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    out = await route({
      method: req.method ?? 'GET',
      path: url.pathname.replace(/\/$/, ''),
      query: url.searchParams,
      headers: req.headers as Record<string, string | undefined>,
      body,
    });
  } catch (e) {
    out = e instanceof HttpError ? { status: e.status, body: { error: e.message } } : { status: 400, body: { error: 'invalid JSON body' } };
  }
  res.writeHead(out.status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(out.body));
}

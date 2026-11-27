// Chirp glasses logic, independent of the SDK so it can be tested against the real server.
export type Card = {
  kind: string;
  ref?: { type: string; id: string };
  lines: string[];
  tap?: string;
  double?: string;
  /** Press-and-hold records a voice note for this card. */
  voice?: string;
  live?: boolean;
};
export type CardResponse = { card: Card; text: string };

export interface Api {
  config?(): Promise<{ bot: string }>;
  createDevice(): Promise<{ deviceId: string; token: string; pairCode: string }>;
  me(token: string): Promise<{ paired: boolean; name: string | null; pairCode: string | null }>;
  /** `hw` says which hardware heard it: the SDK's device model and which mic was listening. */
  heard(token: string, frame: string, hw?: { model: string; mic: MicSource }): Promise<CardResponse>;
  act(token: string, ref: Card['ref'], action: 'tap' | 'double'): Promise<CardResponse>;
  sessionState(token: string, sessionId: string): Promise<CardResponse>;
  /** A spoken note (16 kHz mono WAV, base64) in, a draft card out. */
  note(token: string, ref: Card['ref'], audio: string): Promise<CardResponse>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Deps {
  api: Api;
  show(text: string): Promise<unknown>;
  setMic(on: boolean, source: MicSource): Promise<unknown>;
  exit(): Promise<unknown>;
  getItem(key: string): Promise<string>;
  setItem(key: string, value: string): Promise<unknown>;
  log(msg: string): void;
  botName: string;
  /** The device model the Even Hub SDK reports ('g2' on real glasses); absent in the simulator. */
  model?: string;
}

export type MicSource = 'glasses' | 'phone';
/**
 * The official simulator reports itself as a G2 with this fixed placeholder serial (and battery 100),
 * so the model alone can't tell real glasses from the simulator. Real glasses report their own serial.
 */
export const SIMULATOR_SN = 'S2001234567890';

/** 'g2' only for real glasses; 'simulator' for the official simulator; 'none' when no device is reported. */
export function hardwareLabel(info: { model?: string; sn?: string } | null | undefined): string {
  if (!info?.model) return 'none';
  if (info.sn === SIMULATOR_SN) return 'simulator';
  return info.model;
}

/** `hold-start` is the touchpad going down on a long press; `hold` is its release. */
export type Input = 'tap' | 'double' | 'swipe' | 'hold-start' | 'hold';

/** The mic delivers 16 kHz mono 16-bit PCM: 32,000 bytes a second. Notes stop at 15 s. */
export const NOTE_MAX_PCM = 32_000 * 15;

/** Wrap raw 16 kHz mono 16-bit PCM in a WAV header. */
export function pcmToWav(chunks: Uint8Array[]): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.byteLength, 0);
  const out = new Uint8Array(44 + n);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  tag(0, 'RIFF'); v.setUint32(4, 36 + n, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16_000, true); v.setUint32(28, 32_000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, n, true);
  let at = 44;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const TOKEN_KEY = 'chirp-device-token';
const MIC_KEY = 'mic-source';
const MAX_PENDING = 50;

export class Controller {
  mode: 'starting' | 'pairing' | 'root' | 'card' = 'starting';
  token = '';
  pairCode = '';
  source: MicSource = 'glasses';
  listening = false;
  card: CardResponse | null = null;
  /** Cards heard while another card was on the lens, oldest first. */
  queue: CardResponse[] = [];
  /** A room the wearer swiped away; its chirps still count for presence but don't reopen it. */
  dismissed: string | undefined;
  /** Frames that could not reach the server yet. */
  offline: string[] = [];
  lastTitle = '';
  heardCount = 0;
  /** Mic audio collected while the wearer holds the touchpad on a card that takes a voice note. */
  recording: Uint8Array[] | null = null;
  private recorded = 0;
  private busy = false;

  constructor(private d: Deps) {}

  async start(): Promise<void> {
    this.source = ((await this.d.getItem(MIC_KEY)) as MicSource) || 'glasses';
    this.token = await this.d.getItem(TOKEN_KEY);
    if (this.token) {
      try {
        const me = await this.d.api.me(this.token);
        if (me.paired) return this.goRoot(true);
        this.pairCode = me.pairCode ?? '';
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) this.token = '';
        else return this.showError('Server unreachable', 'check your connection', 'retrying…');
      }
    }
    if (!this.token) {
      const d = await this.d.api.createDevice();
      this.token = d.token;
      this.pairCode = d.pairCode;
      await this.d.setItem(TOKEN_KEY, d.token);
    }
    if (!this.pairCode) {
      // Token exists but the code was consumed by an earlier pairing that later failed: get a fresh device.
      await this.d.setItem(TOKEN_KEY, '');
      return this.start();
    }
    this.mode = 'pairing';
    await this.d.show(
      ['Chirp · pair your Telegram', '', `Open ${this.d.botName} and send`, `      ${this.pairCode}`, '', 'this screen updates by itself'].join('\n'),
    );
    this.d.log(`[chirp] pairing code=${this.pairCode}`);
  }

  /** Called on a timer: pairing status, live session refresh, offline retry. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.mode === 'pairing') {
        const me = await this.d.api.me(this.token);
        if (me.paired) {
          this.d.log('[chirp] paired');
          await this.goRoot(true);
        }
        return;
      }
      if (this.offline.length) {
        const frames = this.offline.splice(0);
        for (const f of frames) await this.onFrame(f);
        return;
      }
      if (this.mode === 'card' && this.card?.card.live && this.card.card.ref?.type === 'session') {
        const next = await this.d.api.sessionState(this.token, this.card.card.ref.id);
        if (next.text !== this.card.text) {
          this.card = next;
          this.d.log(`[chirp] refreshed ${next.card.lines[0] ?? ''}`);
          await this.paint();
        }
      }
    } catch {
      /* the next tick retries */
    } finally {
      this.busy = false;
    }
  }

  async onFrame(frame: string) {
    if (this.mode === 'pairing' || this.mode === 'starting') return;
    this.heardCount++;
    this.d.log(`[chirp] heard ${frame}`);
    let res: CardResponse;
    try {
      // Always report: repeated room codes are what prove presence, even while another card is up.
      res = await this.d.api.heard(this.token, frame, { model: this.d.model ?? 'none', mic: this.source });
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) return this.showError(e.message);
      if (this.offline.length < MAX_PENDING) this.offline.push(frame);
      return this.d.show(`Chirp · offline\n${this.offline.length} heard, will retry\n\nswipe: back`);
    }
    const ref = res.card.ref?.id;
    // Only a card the wearer can still act on holds the lens; a finished result (info) or an error gives way.
    const showing = this.mode === 'card' && this.card && !['error', 'info', 'connected'].includes(this.card.card.kind);
    if (res.card.kind === 'error') {
      if (showing) return; // a bad chirp never covers a good card
      return this.present(res);
    }
    if (ref && ref === this.dismissed) {
      // the wearer swiped this room away: stay quiet, keep counting presence
      this.card = res;
      return this.mode === 'root' ? this.paintRoot() : undefined;
    }
    if (!showing || ref === this.card!.card.ref?.id) return this.present(res);
    if (!this.queue.some((q) => q.card.ref?.id === ref) && this.queue.length < MAX_PENDING) this.queue.push(res);
    return this.paint();
  }

  private present(res: CardResponse) {
    this.card = res;
    this.mode = 'card';
    if (res.card.kind !== 'error') this.lastTitle = res.card.lines[0] ?? '';
    this.d.log(`[chirp] card ${res.card.kind} ${res.card.lines[0] ?? ''}`);
    return this.paint();
  }

  async onInput(input: Input) {
    if (this.mode === 'pairing' || this.mode === 'starting') {
      if (input === 'double') await this.exit();
      return;
    }
    if (input === 'hold-start') {
      const c = this.mode === 'card' ? this.card?.card : undefined;
      if (!c?.voice || !c.ref) return;
      if (!this.listening) await this.startMic();
      this.recording = [];
      this.recorded = 0;
      this.d.log(`[chirp] recording ${c.voice}`);
      return this.d.show(`Recording ${c.voice}\n\nspeak, then let go`);
    }
    if (input === 'hold' && this.recording) return this.finishNote();
    if (input === 'hold') {
      this.listening ? await this.stopMic() : await this.startMic();
      return this.mode === 'root' ? this.paintRoot() : this.paint();
    }
    if (this.mode === 'root') {
      if (input === 'double') return this.exit();
      if (input === 'swipe') {
        this.source = this.source === 'glasses' ? 'phone' : 'glasses';
        await this.d.setItem(MIC_KEY, this.source);
        if (this.listening) await this.startMic();
        return this.paintRoot();
      }
      if (input === 'tap' && this.card) {
        this.dismissed = undefined;
        this.mode = 'card';
        return this.paint();
      }
      return this.paintRoot();
    }
    // A card is on the lens.
    const c = this.card!.card;
    if (input === 'swipe') {
      const next = this.queue.shift();
      if (next) return this.present(next);
      if (c.ref?.type === 'session') this.dismissed = c.ref.id;
      return this.goRoot(false);
    }
    const label = input === 'tap' ? c.tap : c.double;
    if (!label || !c.ref) return this.paint();
    try {
      this.card = await this.d.api.act(this.token, c.ref, input);
      this.d.log(`[chirp] acted ${input} → ${this.card.card.lines[0] ?? ''}`);
      await this.paint();
    } catch (e) {
      await this.showError(e instanceof ApiError ? e.message : 'Could not reach the server', 'try again');
    }
  }

  /** Mic audio goes here first; returns true while it is being recorded as a note (so it is not decoded). */
  recordNote(pcm: Uint8Array): boolean {
    if (!this.recording) return false;
    if (this.recorded < NOTE_MAX_PCM) {
      const part = pcm.subarray(0, NOTE_MAX_PCM - this.recorded);
      this.recording.push(part.slice());
      this.recorded += part.byteLength;
    }
    return true;
  }

  private async finishNote() {
    const chunks = this.recording!;
    this.recording = null;
    const ref = this.card?.card.ref;
    this.d.log(`[chirp] note ${(this.recorded / 32_000).toFixed(1)}s`);
    try {
      this.present(await this.d.api.note(this.token, ref, toBase64(pcmToWav(chunks))));
    } catch (e) {
      await this.showError(e instanceof ApiError ? e.message : 'Could not reach the server', 'try again');
    }
  }

  private async startMic() {
    await this.d.setMic(true, this.source);
    this.listening = true;
    this.d.log(`[chirp] ready source=${this.source}`);
  }

  private async stopMic() {
    await this.d.setMic(false, this.source);
    this.listening = false;
  }

  private async exit() {
    if (this.listening) await this.stopMic();
    await this.d.exit();
  }

  private async goRoot(startListening: boolean) {
    this.mode = 'root';
    if (startListening && !this.listening) await this.startMic();
    await this.paintRoot();
  }

  private paintRoot() {
    const lines = [
      this.listening ? `Chirp · listening (${this.source} mic)` : 'Chirp · paused',
      this.dismissed && this.card ? `in: ${this.lastTitle} · tap to open` : this.lastTitle ? `last: ${this.lastTitle}` : 'waiting for a chirp…',
      this.queue.length ? `${this.queue.length} heard · swipe to see` : '',
      '',
      this.listening ? 'hold: pause · swipe: mic · 2×tap: exit' : 'hold: listen · 2×tap: exit',
    ];
    return this.d.show(lines.join('\n'));
  }

  private paint() {
    if (!this.card) return this.paintRoot();
    const extra = this.queue.length ? `\n+${this.queue.length} heard · swipe for next` : '';
    const paused = this.listening ? '' : '\n(paused)';
    return this.d.show(this.card.text + extra + paused);
  }

  private async showError(...lines: string[]) {
    this.card = { card: { kind: 'error', lines }, text: [...lines, '', 'swipe: back'].join('\n') };
    this.mode = 'card';
    await this.paint();
  }
}

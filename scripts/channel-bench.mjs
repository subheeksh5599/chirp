// How well a chirp survives the codecs that calls, streams and podcasts squeeze audio through.
// Uses the shipped sender settings (AUDIBLE_NORMAL, volume 12, softened, sent twice), runs each
// sound through a real codec with ffmpeg, brings it back to 16 kHz mono (the glasses mic rate)
// and decodes it the way the glasses app does. Offline only: real call apps also run noise
// suppression and echo cancellation, which no file codec models.
//
//   TRIALS=20 node scripts/channel-bench.mjs        (needs ffmpeg on PATH)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { soften } from '@chirp/sound';

const TRIALS = Number(process.env.TRIALS ?? 20);
const VOLUME = 12; // apps/web/src/chirp.ts DEFAULT_VOLUME
const RATE = 48000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** name, what it stands for, ffmpeg encode args, container extension */
export const CHANNELS = [
  ['none (16 kHz mic only)', 'baseline', null, null],
  ['Opus 16 kbps, voice mode', 'a voice call on a weak connection', ['-c:a', 'libopus', '-b:a', '16k', '-application', 'voip'], 'ogg'],
  ['Opus 24 kbps, voice mode', 'a typical voice or video call', ['-c:a', 'libopus', '-b:a', '24k', '-application', 'voip'], 'ogg'],
  ['Opus 64 kbps, music mode', 'a voice chat room', ['-c:a', 'libopus', '-b:a', '64k', '-application', 'audio'], 'ogg'],
  ['AAC 64 kbps', 'a low-bitrate stream', ['-c:a', 'aac', '-b:a', '64k'], 'm4a'],
  ['AAC 128 kbps', 'a normal live stream', ['-c:a', 'aac', '-b:a', '128k'], 'm4a'],
  ['MP3 128 kbps', 'a podcast file', ['-c:a', 'libmp3lame', '-b:a', '128k'], 'mp3'],
  ['G.722 (16 kHz)', 'an HD phone call', ['-ar', '16000', '-c:a', 'g722'], 'wav'],
  ['G.711 mu-law (8 kHz)', 'an old phone line', ['-ar', '8000', '-c:a', 'pcm_mulaw'], 'wav'],
];

const gg = await createRequire(import.meta.url)('ggwave')();
const tx = gg.getDefaultParameters();
tx.sampleRateInp = RATE;
tx.sampleRateOut = RATE;
const txInst = gg.init(tx);
const rx = gg.getDefaultParameters();
rx.sampleRateInp = 16000;
rx.sampleRateOut = 16000;
const P = gg.ProtocolId ?? gg.TxProtocolId;

const frame = () => 'H' + Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join('');

function wav16(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}

function sender(payload, snrDb) {
  const raw = gg.encode(txInst, payload, P.GGWAVE_PROTOCOL_AUDIBLE_NORMAL, VOLUME);
  const chirp = soften(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(), RATE, { repeat: 2 });
  const x = new Float32Array(chirp.length + RATE); // half a second of room either side
  x.set(chirp, RATE / 2);
  if (Number.isFinite(snrDb)) {
    let e = 0;
    for (const v of chirp) e += v * v;
    const amp = (Math.sqrt(e / chirp.length) / 10 ** (snrDb / 20)) * Math.sqrt(3);
    for (let i = 0; i < x.length; i++) x[i] += (Math.random() * 2 - 1) * amp;
  }
  return x;
}

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

/** Through the codec and back to what the glasses mic hands the decoder: 16 kHz mono int16. */
function channel(dir, x, enc, ext) {
  writeFileSync(join(dir, 'in.wav'), wav16(x, RATE));
  let src = join(dir, 'in.wav');
  if (enc) {
    src = join(dir, `coded.${ext}`);
    ff(['-i', join(dir, 'in.wav'), ...enc, src]);
  }
  ff(['-i', src, '-ac', '1', '-ar', '16000', '-f', 's16le', join(dir, 'out.pcm')]);
  const pcm = readFileSync(join(dir, 'out.pcm'));
  const f = new Float32Array(pcm.length / 2);
  for (let i = 0; i < f.length; i++) f[i] = pcm.readInt16LE(i * 2) / 32768;
  return f;
}

function decode(f) {
  const inst = gg.init(rx);
  const heard = new Set();
  for (let i = 0; i < f.length; i += 1600) {
    const chunk = f.slice(i, i + 1600);
    const r = gg.decode(inst, new Int8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    if (r && r.length) heard.add(new TextDecoder().decode(r));
  }
  gg.free?.(inst);
  return heard;
}

const dir = mkdtempSync(join(tmpdir(), 'chirp-channel-'));
const rows = [];
try {
  for (const [name, use, enc, ext] of CHANNELS) {
    const row = { channel: name, 'stands for': use };
    for (const snr of [Infinity, 10]) {
      let ok = 0;
      for (let t = 0; t < TRIALS; t++) {
        const p = frame();
        if (decode(channel(dir, sender(p, snr), enc, ext)).has(p)) ok++;
      }
      row[snr === Infinity ? 'clean' : 'room noise 10 dB SNR'] = `${ok}/${TRIALS}`;
    }
    rows.push(row);
    console.error(`${name}: ${row.clean} clean, ${row['room noise 10 dB SNR']} with noise`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const cols = Object.keys(rows[0]);
console.log(`| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map((c) => r[c]).join(' | ')} |`);

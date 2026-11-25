// Phase 0 codec bench: which ggwave protocol survives the glasses mic path?
// Encodes an 8-byte frame at 48 kHz (sender side), resamples to 16 kHz
// (what the glasses/phone mic delivers), optionally adds noise, then decodes
// at 16 kHz. Prints decode rate per protocol and noise level.
import { createRequire } from 'node:module';
const factory = createRequire(import.meta.url)('ggwave');

const TRIALS = Number(process.env.TRIALS ?? 20);
const SNR_DB = [Infinity, 20, 10, 5, 0]; // white noise, relative to the chirp's own RMS

const gg = await factory();

const tx = gg.getDefaultParameters();
tx.sampleRateInp = 48000;
tx.sampleRateOut = 48000;
const txInst = gg.init(tx);

const rx = gg.getDefaultParameters();
rx.sampleRateInp = 16000;
rx.sampleRateOut = 16000;

const asF32 = (i8) => new Float32Array(i8.buffer, i8.byteOffset, i8.byteLength / 4);
const asI8 = (f32) => new Int8Array(f32.buffer, f32.byteOffset, f32.byteLength);

// 48k -> 16k: 15-tap windowed-sinc low-pass at 7 kHz, then keep every 3rd sample.
function downsample3(x) {
  const N = 31, fc = 7000 / 48000, h = [];
  for (let n = 0; n < N; n++) {
    const m = n - (N - 1) / 2;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    h.push(sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1))));
  }
  const out = new Float32Array(Math.floor(x.length / 3));
  for (let i = 0; i < out.length; i++) {
    let acc = 0;
    for (let k = 0; k < N; k++) {
      const j = i * 3 - k + (N - 1) / 2;
      if (j >= 0 && j < x.length) acc += h[k] * x[j];
    }
    out[i] = acc;
  }
  return out;
}

// Same path the glasses app uses: float -> int16 PCM -> float.
function throughPcm16(x) {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    y[i] = Math.round(s * 32767) / 32768;
  }
  return y;
}

function randomFrame() {
  // 8 bytes printable so ggwave text payload round-trips cleanly (base32-ish alphabet).
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

const P = gg.ProtocolId ?? gg.TxProtocolId;
const protocols = Object.keys(P).filter((k) => /AUDIBLE|DT_/.test(k));

const rows = [];
for (const name of protocols) {
  const id = P[name];
  let durS = 0;
  const row = { protocol: name.replace('GGWAVE_PROTOCOL_', '').replace('GGWAVE_TX_PROTOCOL_', '') };
  for (const snr of SNR_DB) {
    let ok = 0;
    for (let t = 0; t < TRIALS; t++) {
      const payload = randomFrame();
      const wave48 = asF32(gg.encode(txInst, payload, id, 25)).slice();
      durS = wave48.length / 48000;
      // pad with silence before/after, like a real capture window
      const padded = new Float32Array(wave48.length + 48000);
      padded.set(wave48, 24000);
      let wave16 = downsample3(padded);
      if (snr !== Infinity) {
        let e = 0; for (const v of wave48) e += v * v;
        const rms = Math.sqrt(e / wave48.length);
        const amp = (rms / 10 ** (snr / 20)) * Math.sqrt(3); // uniform noise with target RMS
        for (let i = 0; i < wave16.length; i++) wave16[i] += (Math.random() * 2 - 1) * amp;
      }
      wave16 = throughPcm16(wave16);
      const rxInst = gg.init(rx);
      let got = null;
      // feed in 100 ms chunks (1600 samples), as audio events arrive
      for (let i = 0; i < wave16.length && !got; i += 1600) {
        const r = gg.decode(rxInst, asI8(wave16.slice(i, i + 1600)));
        if (r && r.length) got = new TextDecoder().decode(r);
      }
      gg.free?.(rxInst);
      if (got === payload) ok++;
    }
    row[snr === Infinity ? 'clean' : `SNR ${snr} dB`] = `${Math.round((ok / TRIALS) * 100)}%`;
  }
  row['air time'] = `${durS.toFixed(2)} s`;
  rows.push(row);
}
console.table(rows);

// Turns a ggwave waveform into a softer "Chirp" sound.
// - raised-cosine fades at every start and end, so there are no clicks
// - gentle low-pass at 6.8 kHz, removing harsh harmonics the 16 kHz glasses mic
//   can't hear anyway (it only captures up to 8 kHz)
// - optional repeat: the same frame twice with a short pause, so a listener only
//   needs one copy to arrive intact
// Works in the browser and in Node (plain Float32Array in, Float32Array out).

export const SOFT_DEFAULTS = { fadeMs: 25, lowpassHz: 6800, repeat: 1, gapMs: 250 };

function fade(x, rate, ms) {
  const n = Math.min(Math.floor((rate * ms) / 1000), x.length >> 1);
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

// Two cascaded one-pole low-pass stages (~12 dB/octave), cheap and click-free.
function lowpass(x, rate, hz) {
  const a = Math.exp((-2 * Math.PI * hz) / rate);
  let y1 = 0, y2 = 0;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    y1 = (1 - a) * x[i] + a * y1;
    y2 = (1 - a) * y1 + a * y2;
    out[i] = y2;
  }
  return out;
}

/**
 * @param {Float32Array} wave raw ggwave output at `rate`
 * @param {number} rate sample rate of `wave`
 * @param {Partial<typeof SOFT_DEFAULTS>} [opts]
 * @returns {Float32Array}
 */
export function soften(wave, rate, opts = {}) {
  const o = { ...SOFT_DEFAULTS, ...opts };
  const one = fade(lowpass(wave, rate, o.lowpassHz), rate, o.fadeMs);
  if (o.repeat <= 1) return one;
  const gap = Math.floor((rate * o.gapMs) / 1000);
  const out = new Float32Array(one.length * o.repeat + gap * (o.repeat - 1));
  for (let r = 0; r < o.repeat; r++) out.set(one, r * (one.length + gap));
  return out;
}

/** RMS level in dBFS, for comparing loudness between settings. */
export function dbfs(x) {
  let e = 0;
  for (const v of x) e += v * v;
  return 20 * Math.log10(Math.sqrt(e / x.length) || 1e-9);
}

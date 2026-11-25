# Chirp: measurements

Every number here comes from a real run. Each one names how it was produced so it can be repeated.

## 1. Codec through the 16 kHz mic path (offline)

`npm run bench:codec` · 20 trials per cell · 8-character payloads · encoded at 48 kHz, low-passed and decimated to 16 kHz, quantised to 16-bit PCM (the format the glasses deliver), white noise added relative to the chirp's own RMS, decoded in 100 ms chunks the way audio events arrive.

| Protocol | clean | SNR 20 dB | SNR 10 dB | SNR 5 dB | SNR 0 dB | air time |
|---|---|---|---|---|---|---|
| **Audible normal** (used) | 100% | 100% | 100% | 100% | 95% | 1.64 s |
| Audible fast | 100% | 100% | 95% | 95% | 80% | 1.32 s |
| Audible fastest | 0% | 0% | 0% | 0% | 0% | 1.00 s |
| Dual-tone (all speeds) | 0% | 0% | 0% | 0% | 0% | 1.6–3.6 s |

Raw output: [`bench-codec-sim.txt`](bench-codec-sim.txt).

## 2. Frequency band

The audible-normal chirp's energy sits between **1,875 Hz and 6,094 Hz**; **100%** of it is below the 8 kHz limit of a 16 kHz microphone.

## 3. Through the air into the simulator (worst case)

`scripts/e2e-sim.mjs` · the Mac's own speaker plays into the Mac's own microphone, which the simulator streams to the glasses app as 16 kHz PCM. A laptop treats its own speaker output as echo and suppresses part of it; a raw capture (`scripts/analyze-capture.mjs`) showed chirps arriving with good SNR (22–26 dB above the room) but **shortened to about 1 s of the 1.6 s**, which is what breaks decoding. A separate sender (a phone) does not go through that echo path; that test is still open.

| Setup (Mac speaker → Mac mic) | Decoded |
|---|---|
| One copy, raw tones, volume 20–40 | 24 of 40 (60%) across 4 runs |
| Two copies in one chirp, raw, volume 20 | 18 of 20 (90%) |
| Two copies, softened (fades, 6.8 kHz low-pass), volume 20 | 8 of 10 (80%) |
| Two copies, softened, volume 12 (≈ 4 dB quieter) | 8 of 10 (80%) |
| Longer pauses between chirps (0.8 s vs 2 s) | no measurable change |

The shipped default is **two softened copies at volume 12**: it decoded as often as louder settings and is the least intrusive.

## 4. Full acoustic end to end

`npm run e2e:room` · simulator + real local API + real Postgres (throwaway schema) + sound through the Mac speaker.

| Check | Result |
|---|---|
| First launch shows a pairing code | ✓ |
| Pairing is picked up by the lens | ✓ |
| A room chirp through the air opens the slide card | ✓ (2 and 4 chirps needed in two runs) |
| A slide change reaches the lens without a new chirp | ✓ |
| A tap on the glasses votes in the poll | ✓ (vote recorded in the database) |

## 5. Not measured yet

- A phone as the sender, at 1, 3 and 5 m.
- Real glasses (their microphone path may differ from the simulator's).
- Voice-call audio (Telegram group call, video call) and stream audio after compression.

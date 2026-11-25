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

### 4b. A real presence run on production

`npm run presence:live`, 2026-11-25: a session on production played its rotating room code from the Mac speaker every ~12 s, into the simulator running the glasses app. The glasses heard **6 of 8** room codes, enough for the session's rule (2 codes across 1 minute), and the claim produced record `27VHDCYT`. Same worst-case setup as §3 (a laptop into its own mic).

## 5. Through call and stream codecs (offline)

`npm run bench:channels` (`scripts/channel-bench.mjs`, 20 random codes per row). Each code is made with the shipped sender settings (normal mode, volume 12, softened, sent twice). It goes through a real codec with ffmpeg, comes back as 16 kHz mono (what the glasses mic delivers), and is decoded the way the glasses app decodes it. "Room noise" adds white noise 10 dB below the chirp before the codec. Raw output: [`bench-channels.txt`](bench-channels.txt).

| channel | stands for | clean | room noise 10 dB SNR |
|---|---|---|---|
| none (16 kHz mic only) | baseline | 20/20 | 20/20 |
| Opus 16 kbps, voice mode | a voice call on a weak connection | 20/20 | 12/20 |
| Opus 24 kbps, voice mode | a typical voice or video call | 20/20 | 20/20 |
| Opus 64 kbps, music mode | a voice chat room | 20/20 | 20/20 |
| AAC 64 kbps | a low-bitrate stream | 20/20 | 20/20 |
| AAC 128 kbps | a normal live stream | 20/20 | 20/20 |
| MP3 128 kbps | a podcast file | 20/20 | 20/20 |
| G.722 (16 kHz) | an HD phone call | 20/20 | 20/20 |
| G.711 mu-law (8 kHz) | an old phone line | 0/20 | 0/20 |

- Every modern call, chat-room, stream and podcast codec carried the code 20 times out of 20 when clean.
- The weakest call setting (Opus at 16 kbps) with a noisy room dropped to 12 of 20.
- An old 8 kHz phone line can't carry it at all: that line stops at 4 kHz and the chirp's tones reach 6.1 kHz.
- **Limit:** call apps also run noise suppression and echo cancellation, which can treat a chirp as noise. No file codec models that, so a live call is still unmeasured.

## 6. Not measured yet

- A phone as the sender, at 1, 3 and 5 m.
- Real glasses (their microphone path may differ from the simulator's).
- A live voice or video call, with the app's own noise suppression on.

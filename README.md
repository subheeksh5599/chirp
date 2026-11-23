# Chirp

> **Status:** planning. No code yet. Nothing below is built or verified unless the status table says so.

**Any speaker can talk to your glasses.**

Display glasses can show you things and hear you, but they cannot see. They have no camera, no NFC, and apps get no Bluetooth scanning. Chirp makes the microphone their way to receive from the world. A phone, laptop, PA system or livestream plays a short chirp carrying a small code. The glasses hear it, and the right thing appears on the lens. One tap acts on it.

The sender needs no app install, no pairing, no Wi-Fi link to the glasses and no GPS. The sound alone carries the code, to one person or a whole room at once.

## What it does: four layers

| Layer | What it is | Example |
|---|---|---|
| **1. Hand-off** | One device passes one thing to one wearer | Someone's phone chirps their card, tap, connected on Telegram |
| **2. Broadcast** | One speaker reaches every wearer in the room | The speaker's audio carries the session code, and every lens follows the current slide, a live poll (tap to vote) and the live subtitles |
| **3. Presence** | Hearing the room's rotating code proves you were there | At the end of a talk: `✓ You were here · claim · tap`, giving a credential only people in the room can claim |
| **4. Sync** | Sound as a clock | A livestream's audio carries markers, and the lens shows the exact market the host is talking about, with live odds |

**Lead story: a live talk.** Every lens follows the slides. A poll pops up and the room votes with a tap. At the end, everyone who was physically present claims a presence credential. Nobody scans a QR code or opens an app.

## How it works

```
 speaker / sender                    server                          glasses app
 ────────────────                    ──────                          ───────────
 session key ──────────────────────▶ knows the key
 audio carries code(slot) ─ ─ ─ sound through the air ─ ─ ─ ─ ─ ─ ▶ mic PCM 16 kHz
   (new code every few seconds)                                      decode code
                                     verify code ◀────────────────── report (code, time)
                                     return lens state ────────────▶ slide / poll / card
                                     record action ◀──────────────── tap (vote, claim, connect)
 Telegram / wallet ◀────────────────
```

- The sound carries **only a short code**, never the content itself. The server turns codes into slides, polls, cards or claims.
- Presence codes **change every few seconds** and come from the session key, so the server can check them and nobody can guess the next one.
- Tones stay below 8 kHz because the glasses mic records at 16 kHz. The chirp is a short audible beep, not ultrasonic.
- Every third-party call goes through the server, and no keys ship in the glasses app.

Design: [`docs/PLAN.md`](docs/PLAN.md) · Build order: [`docs/ROADMAP.md`](docs/ROADMAP.md) · Sound format: [`docs/PROTOCOL.md`](docs/PROTOCOL.md)

## Verification status

| Claim | Status |
|---|---|
| A code decodes from a chirp at 16 kHz in the glasses app (simulator) | ⏳ not yet tested |
| Decodes on real glasses through their own microphone | ⏳ not yet tested |
| Decodes from a speaker's PA / laptop audio at room distance | ⏳ not yet tested |
| Broadcast: lens follows a live session's slides and polls | ⏳ not yet built |
| Presence: credential claimable only with codes heard live | ⏳ not yet built |
| Presence: replayed old audio is rejected | ⏳ not yet built |
| Hand-off: connect sends a real Telegram message | ⏳ not yet built |
| Sync: livestream marker opens the matching live market | ⏳ not yet built |

Rows only move to ✅ after a real run, with the evidence linked.

## Known limits (stated up front)

- **Livestream cheating:** someone watching a live stream of the room also hears the codes. Short code lifetimes plus normal stream delay block most of it. A very low-delay stream could still pass, and the docs say so rather than claiming otherwise.
- **Audible:** every chirp is a short beep. It's fine in talks and streams, but the repeat rate has to stay low.
- **Opt-in senders:** venues, speakers and streams must choose to chirp. Talks and streams are realistic now. Public spaces like stations and airports are later.
- **Real glasses unverified:** the glasses mic path may filter tones. Simulator results do not prove real-device results.

## Repo layout (planned)

```
apps/glasses/   glasses app: mic capture, decoder, lens views, taps
apps/sender/    speaker console, Telegram Mini App, livestream marker tool
apps/server/    sessions, codes, verification, actions, Telegram bot, chain client
packages/wire/  shared frame format, CRC, code derivation
docs/           plan, roadmap, protocol
```

## Setup

Not runnable yet. Setup steps land with the first working slice (roadmap phase 1).

## Principles

- **Real data only.** No mock sessions, fake votes, invented claims or simulated messages in the product path.
- **Money safety.** Testnet only. The app holds no funds and never signs. Anything on-chain confirms on the wearer's own wallet.
- **Privacy.** The mic buffer lives in memory only and is decoded then dropped. Long press pauses listening. Only decoded codes leave the device.
- **Fail closed.** A missing key or an unreachable service shows the real reason on the lens, never a made-up screen.

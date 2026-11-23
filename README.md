# Chirp

> **Status:** planning. No code yet. Nothing below is built or verified unless the status table says so.

**A QR code you hear instead of scan.**

Display glasses can show you things and hear you, but they cannot see. They can't scan a QR code, read NFC, or look for nearby Bluetooth devices. Chirp gives them a way to receive from the world through the one sense they have: the microphone.

A nearby phone, laptop or tablet plays a short chirp. The glasses hear it, decode a small token from the sound, and show a card on the lens. One tap acts on it.

## What it does

| Flow | Sender | What the wearer sees | One tap does |
|---|---|---|---|
| **Connect** | Someone's phone (Telegram Mini App) | `Sam Reyes · founder · tap to connect` | Sends Sam a Telegram intro and saves the contact with where you met |
| **Talk** | Speaker's laptop (web page) | `Slides + channel for "Building on TON"` | Saves the slides link and joins the Telegram channel |
| **Pay** | Counter tablet (web page) | `Café Noor · 9.50 USDT · tap to pay` | Opens the payment request on the wearer's phone wallet (testnet). The glasses never sign anything |

## How it works

```
 sender device                       backend                          glasses app
 ─────────────                       ───────                          ───────────
 Mini App / web page ──create──▶ issue short-lived token
 plays chirp (token) ─ ─ ─ ─ sound through the air ─ ─ ─ ─ ─ ─ ─ ─▶ mic PCM 16 kHz
                                                                     decode token
                                 resolve token ◀────────────────── request card
                                 return card  ──────────────────▶ show card on lens
                                 run action   ◀────────────────── tap
 Telegram message / wallet link ◀────────────
```

- The sound carries **only a short random token**, never the contact, amount or link itself. The backend resolves it, so a recording of the chirp is useless after the token expires.
- Tones stay below 8 kHz because the glasses microphone records at 16 kHz. The chirp is audible: a short beep, not ultrasonic.
- All API calls go through our backend. No keys ship inside the glasses app.

Full design: [`docs/PLAN.md`](docs/PLAN.md). Build order: [`docs/ROADMAP.md`](docs/ROADMAP.md). Sound format: [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Verification status

| Claim | Status |
|---|---|
| Token decodes from a chirp at 16 kHz in the glasses app (simulator) | ⏳ not yet tested |
| Decodes on real glasses through their own microphone | ⏳ not yet tested |
| Connect flow sends a real Telegram message | ⏳ not yet built |
| Talk flow joins a real Telegram channel | ⏳ not yet built |
| Pay flow opens a real testnet payment request | ⏳ not yet built |
| Replayed recording of an old chirp is rejected | ⏳ not yet built |

Rows only move to ✅ after a real run, with the evidence linked.

## Repo layout (planned)

```
apps/glasses/   glasses app: mic capture, decoder, lens cards, taps
apps/sender/    Telegram Mini App + web sender (connect, talk, pay)
apps/server/    backend: tokens, resolve, actions, Telegram bot
packages/wire/  shared payload format, CRC, token encoding
docs/           plan, roadmap, protocol
```

## Setup

Not runnable yet. Setup steps land with the first working slice (roadmap phase 1).

## Principles

- **Real data only.** No mock contacts, fake payments or simulated messages anywhere in the product path.
- **Money safety.** Testnet only. The app holds no funds and never signs; payment always confirms on the wearer's own phone wallet.
- **Privacy.** The mic buffer lives in memory only. Nothing is recorded, uploaded or stored except decoded tokens.
- **Fail closed.** A missing key or an unreachable service shows a plain error on the lens. It never shows a made-up card.

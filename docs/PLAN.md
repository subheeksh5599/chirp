# Chirp: build plan

## 1. The problem

Display glasses have a private screen, a microphone, touch controls and a ring. They have no camera, no NFC, and apps get no Bluetooth scanning. Every everyday "hand me something" gesture (a QR code to connect, a QR to pay, a QR on a slide) needs a phone.

Chirp turns sound into that missing receive channel.

## 2. Who it's for

| Person | Moment | What they lose today |
|---|---|---|
| Event-goer, founder, investor, recruiter | Meeting 20–40 people at an event | Phones out for every contact, typos in usernames, forgetting who was who |
| Speaker, teacher, organiser | Sharing slides or a channel with a room | "Scan this before I change the slide", half the room misses it |
| Customer at a counter that takes crypto | Paying a bill | Finding and scanning the shop's QR, checking the amount by hand |

Lead with the first row. It's the most frequent and the most painful.

## 3. Components

### 3.1 Glasses app (`apps/glasses`)
- Web app running inside the glasses companion app on the phone, talking to the glasses through the SDK.
- Opens the **glasses microphone** (`audioControl(true, Glasses)`), receives PCM 16 kHz, signed 16-bit, mono, 100 ms per event.
- Converts to float32, feeds a rolling buffer to the **data-over-sound decoder** (open-source codec, WASM build) configured for a 16 kHz input rate.
- On a decoded frame: check the version byte and CRC (see PROTOCOL.md), then call `GET /resolve/:token`.
- Shows one card per screen, at most 3 lines. Inputs:
  - **tap**: run the card's action
  - **double-tap**: dismiss
  - **long press**: pause listening (privacy toggle)
- An idle screen shows `listening…` or `paused`. A failed resolve shows the reason in plain words.
- Pairing: a 6-digit code links the glasses app to the wearer's Telegram account through the bot. Google sign-in does not work in this WebView.
- Keeps no secrets. The backend host must be whitelisted in `app.json`.

### 3.2 Sender (`apps/sender`)
- **Telegram Mini App** for the Connect flow: the person opens it from the bot, sees their own card preview, and taps "Chirp". The Mini App asks the backend for a fresh token and plays it.
- **Web page** for Talk and Pay: the speaker or shop creates a beacon (slides URL plus channel, or amount plus memo) and the page chirps on a button press or every N seconds.
- Uses the same codec in JS/WASM at 48 kHz output, with the protocol limited to tones below 8 kHz.

### 3.3 Backend (`apps/server`)
- TypeScript, Node. HTTP API plus Telegram bot in one service.
- Storage: SQLite for the first slices, with a migration path to Postgres.
- Endpoints:
  - `POST /beacons`: create a beacon of type `connect | talk | pay` with its payload
  - `POST /beacons/:id/token`: issue a short-lived token (default 60 s, single beacon)
  - `GET /resolve/:token`: return the lens card if the token is live
  - `POST /actions/:token`: run the action for the paired wearer
  - `POST /pair`: link a glasses session to a Telegram user via a 6-digit code
  - `GET /health`: booleans only, no values
- Telegram bot jobs:
  - Pairing codes
  - **Connect**: send the intro message to the other person ("Subheeksh, met at …, wants to connect"). Only possible because that person opened the bot through the Mini App.
  - **Talk**: send the wearer the slides link and the channel invite link
  - Saved contacts list (`/met`) with where and when you met
- **Pay**: build a TON testnet payment link (address, amount, memo) and return it as the action. The tap opens it on the wearer's phone wallet, and the wearer confirms there. The server never holds keys or funds.

### 3.4 Shared wire format (`packages/wire`)
- Payload encoding, CRC-8, token alphabet, version byte. Used by the sender, glasses and server so all three agree byte for byte.

## 4. Security and safety

| Risk | Control |
|---|---|
| Someone records a chirp and replays it later | Tokens expire in 60 s and each is tied to one beacon. The server rejects expired tokens and logs replays |
| Someone spams fake chirps in a room | A token must exist on the server, so a random sound decodes to nothing. The glasses rate-limit resolves |
| Wrong payment amount or address | The card shows the shop name, amount and token, and the wallet shows them again. The app never signs |
| Mic privacy | Audio stays in memory, is decoded and dropped. Long press pauses listening. Nothing is uploaded except decoded tokens |
| Keys in the client | None. Every third-party call goes through the backend |

## 5. Testing

- **Codec round-trip:** encode a token, render to PCM at 48 kHz, resample to 16 kHz, decode. Must match.
- **Noise:** mix recorded room noise (chatter, café, street) at several levels and record the decode rate per level. Report the numbers, don't claim them.
- **Distance:** a real phone chirping at 0.5 m, 1 m and 2 m from the laptop mic in the simulator. Record the decode rate.
- **Simulator automation:** drive taps through the simulator's HTTP automation port and assert lens text from its screenshot API.
- **End to end:** a real Telegram account and a real testnet address. Every status row in the README moves to ✅ only with a linked run.
- **Real glasses:** a beta build pushed to a tester's glasses through the store's tester flow, if a tester is available. Until then the README says "not verified on real glasses".

## 6. Open questions

1. Does the glasses microphone path filter or compress audio in a way that damages tones? It can only be answered on real glasses.
2. Which codec protocol (speed vs robustness) decodes best at 16 kHz input? Measured in phase 0.
3. How long does it take from the chirp ending to the card showing? Target under 1.5 s.
4. Does the glasses app keep receiving mic data while the phone is locked? Field notes suggest sideloaded apps can run for a while, so measure it.

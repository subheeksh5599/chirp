# Chirp: build plan

## 1. The problem

Display glasses have a private screen, a microphone, touch controls and a ring. They have no camera, no NFC, and apps get no Bluetooth scanning. They can show and hear, but they can't take anything in from the world around them without the phone coming out.

Chirp turns sound into that missing channel: **any speaker can address the glasses**, from a phone a metre away to a PA system or a livestream.

## 2. Who it's for

| Person | Moment | What they lose today |
|---|---|---|
| **Audience at a talk, meetup or class** | Following slides, voting, getting links | "Scan this before I change the slide", half the room misses it, polls need phones out |
| **Organisers and communities** | Proving who actually showed up | Check-in desks, QR codes shared in group chats, bots farming attendance rewards |
| **Speakers** | Engaging the room | No way to push the current slide, a poll or the deck to everyone at once |
| **Event-goers** | Meeting people | Phones out for every contact, usernames misspelled |
| **Stream and podcast viewers** | Following what the host is talking about | Pausing to search for the market, link or stat mentioned |

The lead user is the **audience at a live talk**, because broadcast and presence together give the strongest real moment.

## 3. The four layers

### 3.1 Broadcast (lead)
- The speaker opens the **speaker console** (web), starts a session, and connects the deck: a slide list with optional notes, a poll per slide, and the deck link.
- The console plays a chirp every N seconds (default 20 s) through the room audio or the laptop speaker. Each chirp carries the **current session code** (see 3.2) plus the **slide number**.
- The wearer's glasses decode it and show the current slide title plus one line, or the live poll:
  ```
  Poll · "Ship weekly or monthly?"
  tap: weekly · 2×tap: monthly
  ```
- Votes go to the server. The speaker console shows live results.
- **Live subtitles (optional):** the console streams the speaker's speech-to-text to the server, and wearers who joined by sound see the subtitles, translated into their language if set.
- Joining needs no QR, no link and no app on the sender's side. Hearing the room is joining the room.

### 3.2 Presence
- Each session has a **session key** on the server. The code for time slot `t` (default 5 s slots) is `code(t) = truncate(HMAC(session_key, t), 40 bits)`.
- The glasses report every code they hear together with their own timestamp. The server checks each code matches its slot (±1 slot).
- **Presence rule (default):** at least 3 valid codes from slots spread across at least 10 minutes of the session. A single code shared in a chat does not qualify. Being in the room for a stretch does.
- At the end, the lens shows:
  ```
  ✓ You were here · 42 min
  tap: claim
  ```
- **Claim:** the server issues a signed presence record (session, wearer, time window, number of codes heard). The wearer can optionally anchor it on the **TON testnet**: the tap opens a testnet transaction on their phone wallet that records the claim against a presence contract. Confirming happens on the phone, and the server never signs for the wearer.
- **Uses that consume the record:** rewards and allowlists for people who attended, votes open only to people in the room, and proof of attendance for communities. All of this sits on the organiser's side. Chirp provides the record.

### 3.3 Hand-off
- One sender, one wearer. The person opens the **Telegram Mini App** and taps "Chirp", and their phone plays a short-lived code linked to their card.
- The lens shows `Sam Reyes · founder · tap to connect`. The tap makes the bot send Sam an intro and saves the contact with where and when you met (`/met` in the bot).
- The same mechanism covers a counter bill: the lens shows `Café Noor · 9.50 USDT · tap to pay`, and the tap opens a testnet payment link on the phone wallet.

### 3.4 Sync
- A **livestream marker tool** lets a host tag moments ("now discussing market X"). The tool mixes a chirp into the stream audio carrying a marker code.
- Viewers wearing glasses see the matching live item, for example a prediction market's current odds with a paper-bet tap, at the moment the host mentions it.
- Stream audio is compressed, so markers use the most robust codec mode and repeat once.

## 4. Components

### 4.1 Glasses app (`apps/glasses`)
- Web app in the glasses companion app's WebView, connected to the glasses through the SDK.
- Mic: glasses microphone, PCM 16 kHz signed 16-bit mono, 100 ms per event. Converted to float32 and fed to a rolling buffer, then to the data-over-sound decoder (open-source codec, WASM) set for 16 kHz input.
- Decoded frame: check the version and CRC, de-duplicate, then call the server (`POST /heard`).
- Views (one at a time, at most 3 lines): idle `listening…`, slide, poll, subtitle line, card, presence claim, error.
- Inputs: tap = primary action, double-tap = secondary or dismiss, long press = pause listening.
- Pairing: 6-digit code through the Telegram bot. Google sign-in doesn't work in this WebView.

### 4.2 Sender apps (`apps/web`)
- **Speaker console** (web): sessions, deck, polls, chirp timer, live results, subtitle stream.
- **Telegram Mini App**: hand-off cards and counter bills.
- **Livestream marker tool** (web): tag moments, and the tool outputs chirp audio to mix into the stream.

### 4.3 Server (`server`, deployed as one Vercel function)
- TypeScript, Node. HTTP API plus Telegram bot, on Neon Postgres.
- Endpoints:
  - The built routes are listed in the README API table. The glasses make two calls: `POST /api/heard` (frame → card) and `POST /api/act` (tap or double-tap on a card).
- Bot: pairing, intros, `/met`, links for talks, presence-record delivery.
- Chain client: builds testnet transactions for presence anchoring and payments and returns them as wallet links. Holds no keys for wearers.

### 4.4 Shared wire format (`packages/wire`)
- Frame layout, CRC-8, HMAC code derivation, slot maths. One implementation, used byte for byte by the console, glasses and server.

## 5. Security and safety

| Risk | Control | Test |
|---|---|---|
| A code is shared in a group chat | One code never qualifies. Presence needs several codes spread across the session | `one code shared in a chat does not qualify` |
| A recording is replayed later | Codes are tied to 5 s slots. Old slots are rejected and replays are logged | `rejects a recording of an old code and a forged code`, `logs each rejected code with why it was refused` |
| A livestream of the room | Short slots plus the usual stream delay block most cases. A low-delay stream can still pass, which is a documented limit. Organisers can require more codes or a longer stay | `matches the current slot and ±1, but not ±2`; `organisers can set a stricter or shorter rule` |
| A forged code | Without the session key you can't produce a valid code, and random sounds decode to nothing | `rejects a code made with the wrong key` |
| Spam chirps | The frame check drops noise, the server rejects unknown codes, and resolves are rate-limited per device | `any single character changed to a non-alphabet character is rejected`; `a device spamming chirps is slowed down; other devices are not` |
| Wrong payment | The lens shows the shop, amount and memo, and the wallet shows them again. The app never signs | `a bill previews exactly what the wearer sees`; `tap sends a wallet link with a unique comment; unpaid until it is on-chain` |
| Mic privacy | In-memory buffer only, nothing recorded or uploaded. Long press pauses listening | `root gestures: swipe switches mic, hold pauses, double-tap exits` |
| Keys in the client | None. All third-party calls go through the server | `the real glasses build calls only whitelisted origins, and uses every one` |

## 6. Testing

- **Codec round-trip:** encode, render at 48 kHz, resample to 16 kHz, decode, and compare.
- **Code derivation:** fixed test vectors for `code(t)`, plus a ±1-slot tolerance test.
- **Presence rule:** unit tests for one code (fails), three codes in 2 minutes (fails), and three codes spread across 10+ minutes (passes).
- **Room tests:** a real laptop speaker and a real phone at 1, 3 and 5 m from the laptop mic in the simulator, in quiet, chatter and music. Publish the decode rate per case.
- **Stream test:** chirp mixed into a real stream, then decoded from the viewer's audio, with the decode rate recorded.
- **Simulator automation:** drive taps through the simulator's HTTP automation port and assert lens text from its screenshot API.
- **End to end:** real Telegram accounts and a real testnet wallet. README rows move to ✅ only with a linked run.
- **Real glasses:** a beta build on a tester's glasses if one is available. Until then: "not verified on real glasses".

## 7. Open questions

1. Does the glasses mic path filter or compress tones? Only real glasses can answer.
2. Which codec mode survives room audio and stream compression at 16 kHz input? Measured in phase 0.
3. What's the best chirp interval that is reliable without being annoying? Tested with real listeners.
4. How long does the app keep receiving mic data with the phone locked during a long talk?
5. What is the smallest code length that keeps guessing infeasible within one slot? It is 40 bits today, and phase 0 checks whether that fits in the air time.

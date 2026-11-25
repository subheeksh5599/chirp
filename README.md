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

## Why it's useful every day

Most of what people hear in a day is followed by "the link is in the chat", "scan this", "I'll send it to you" or "search for it later". Each one means stopping, taking the phone out and hunting for the thing. Chirp turns each of those moments into **one tap that lands in Telegram**.

| Everyday moment | How often | Who chirps | What the lens shows | One tap does |
|---|---|---|---|---|
| **Group voice chat or call** ("link's in the chat") | Daily for community members and remote teams | The host's phone or laptop, held near their mic | `Host shared: "Launch thread"` | Saves the link to your Telegram Saved Messages |
| **Meeting someone** ("what's your Telegram?") | Several times a week | Their phone, from the Mini App | `Sam Reyes · founder · tap to connect` | Bot sends the intro and saves where you met |
| **Class, meetup or talk** ("scan before I change the slide") | Weekly, daily for students | The speaker's laptop | Current slide, live poll | Vote, save the deck, join the channel |
| **Stream or podcast** ("check the market I'm talking about") | Daily for viewers | Mixed into the stream audio | The exact market with live odds | Saves it or places a paper bet |
| **Counter or stall** ("scan to pay") | When you shop where crypto is accepted | The counter tablet | `Café Noor · 9.50 USDT` | Opens the testnet payment on your phone |
| **Arriving somewhere** (Wi-Fi, menu, check-in) | Daily in offices and venues | A screen or speaker on the wall | `Office Wi-Fi · tap to save` | Sends the details to Saved Messages |

### Design rules that make it a habit, not a demo

1. **Every chirp ends in Telegram.** Links, contacts, decks, markets and bills all land as a message in your own chat with the bot, so you keep everything you heard without taking notes.
2. **A daily "Heard" log.** The bot keeps `/heard`: everything your glasses caught today, with time and place, so you can find "that link from the morning call" in one search.
3. **Anyone can send in 10 seconds.** The sender is a Telegram Mini App or a web page with nothing to install. If you can share a link, you can chirp it.
4. **Missed it? It waits.** If the wearer is reading something else, the chirp queues and shows as `1 heard · tap to see` instead of being lost.
5. **One tap for the obvious action, double-tap for the other.** Smart defaults per type (save, connect, vote, pay) mean no menus and no dictation.
6. **Join late, still get it.** Broadcast sessions send the current state on every chirp, so someone walking in 20 minutes late sees the current slide and the open poll at once.

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
| A chirp survives voice-call audio (group call, video call) and decodes on the listener's side | ⏳ not yet tested |
| Every heard item lands in Telegram and shows in `/heard` | ⏳ not yet built |

Rows only move to ✅ after a real run, with the evidence linked.

## Known limits (stated up front)

- **Livestream cheating:** someone watching a live stream of the room also hears the codes. Short code lifetimes plus normal stream delay block most of it. A very low-delay stream could still pass, and the docs say so rather than claiming otherwise.
- **Call audio:** voice calls compress sound and cut noise, which can damage tones. Calls use the most robust mode, and decode rates over real calls get measured before any claim is made.
- **Audible:** every chirp is a short beep. It's fine in talks and streams, but the repeat rate has to stay low.
- **Opt-in senders:** venues, speakers and streams must choose to chirp. Talks and streams are realistic now. Public spaces like stations and airports are later.
- **Real glasses unverified:** the glasses mic path may filter tones. Simulator results do not prove real-device results. Fallback: the SDK can also capture from the **phone's microphone** (same 16 kHz format), so a "listen with phone" setting keeps Chirp working even if the glasses mic path proves unsuitable.

## Definition of done

Chirp counts as finished only when every line below is true and checked on a real run. The list follows the store's published review rubric plus our own evidence rules.

**Works end to end**
- [ ] All four layers run on real accounts: broadcast (slides + poll votes), presence (claim + testnet anchor), hand-off (Telegram connect + testnet pay), sync (stream marker opens the live market)
- [ ] Every heard item lands in Telegram and shows in `/heard`
- [ ] Decode rates are measured and published: distance, room noise, call audio, stream audio
- [ ] Replay, forgery and single-shared-code attacks are refused by tests

**Ships like a real app**
- [ ] `app.json` valid: lowercase reverse-domain `package_id`, name ≤ 20 characters, `x.y.z` version, `min_sdk_version` set, only permissions that are used (`network` with whitelist, `g2-microphone`, `phone-microphone` only if the fallback ships)
- [ ] Packs into `.ehpk` with `evenhub pack app.json dist --sdk-ver <installed>`; no keys or secrets inside
- [ ] First launch never shows a black screen: the lens explains pairing, and setup is remembered in local storage
- [ ] Runs with the phone locked: core flow works on glasses + ring alone, still alive after 2 minutes idle
- [ ] Root-page double-tap calls the system exit dialog (`shutDownPageContainer(1)`), and the phone-side page closes with it
- [ ] Server sends correct CORS headers, and every domain is in the whitelist
- [ ] Greyscale icon and screenshots taken from the simulator; privacy policy covers every permission and names the backend domain

**Honest and reproducible**
- [ ] A fresh clone runs by following Setup, with no undocumented steps
- [ ] Tests pass in CI (`packages/wire` vectors, presence rule, server routes)
- [ ] The status table above has no ⏳ rows that the README claims elsewhere
- [ ] A short video in this README shows all four layers on real accounts
- [ ] Prior work is listed: the open-source data-over-sound codec and every library used

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

<div align="center">

<img src="apps/glasses/icon.png" width="48" height="48" alt="Chirp icon: a dot with three sound arcs" style="image-rendering: pixelated">

# CHIRP

### Any speaker can talk to your glasses.

[![CI](https://img.shields.io/github/actions/workflow/status/subheeksh5599/chirp/ci.yml?branch=main&label=CI)](https://github.com/subheeksh5599/chirp/actions)
![Tests](https://img.shields.io/badge/tests-110%20passing-2ecc71)
[![Live](https://img.shields.io/badge/live-chirp--liart--six--38.vercel.app-6ef0a0)](https://chirp-liart-six-38.vercel.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
![Stack](https://img.shields.io/badge/TypeScript%20·%20Even%20Hub%20SDK%20·%20Telegram%20·%20TON%20testnet-14151a)

**[ Try it ↓ ](#try-it-in-five-minutes)** · **[ See it in one command ↓ ](#-see-it-in-one-command)** · **[ Measurements ↓ ](#what-the-sound-measurements-say)** · **[ Status table ↓ ](#whats-real-the-status-table)** · **[ Architecture ↓ ](#architecture)**

</div>

Display glasses can show you things and hear you, but they can't see. No camera, no NFC, and apps get no Bluetooth scanning, so every "scan this", "the link is in the chat" and "what's your Telegram?" still needs the phone to come out. **Chirp makes the microphone the glasses' way to receive from the world.** A phone, a laptop, a PA system or a stream plays a short, soft chirp that carries a 9-character code. The glasses hear it, the server turns the code into a card, and the lens shows it. One tap acts on it, and the result lands in Telegram.

Chirp targets **Even Realities G2** glasses. Their apps are web pages that run inside the Even Hub app on the paired phone; `.ehpk` is that platform's app package.

> **Verified so far:** everything runs against production services, and the glasses app runs in the official Even Hub simulator, which hears the room through the laptop mic. A phone chirping a shared link into the simulator opened the link card (simulator log: `heard HJ6YH7G4Y`, `card link Test link`). Not tested yet: real G2 glasses, a phone sender measured over many trials, a live stream. The [status table](#whats-real-the-status-table) says which line is which.

```
SOUND CARRIES A CODE  ≠  THE CODE CARRIES CONTENT  ≠  HEARING ONCE PROVES YOU WERE THERE
```

The sound only carries a short code. The content lives on the server. And presence is a rule over many rotating codes, not one. By default it takes at least **3 different room codes heard across at least 10 minutes** (the speaker can change both), so a single code recorded and posted to a group chat never qualifies.

A **frame** is the 9 characters one chirp carries. A **slot** is a 5-second window; a room's code changes every slot. The sound codec is [ggwave](https://github.com/ggerganov/ggwave).

## Live status

| Surface | Status | The evidence |
|---|---|---|
| API | ✅ live | `GET /api/health` on [chirp-liart-six-38.vercel.app](https://chirp-liart-six-38.vercel.app/api/health), output [below](#-see-it-in-one-command) |
| Sender tools (console, link, bill, markers, Mini App) | ✅ live | [chirp-liart-six-38.vercel.app](https://chirp-liart-six-38.vercel.app); the console and link screenshots above are from production |
| Telegram bot | ✅ webhook set | message [@Chirp567_bot](https://t.me/Chirp567_bot); `GET /api/config` returns its name from its own token |
| Glasses app | ✅ runs in the simulator, packs to `.ehpk` | `npm run e2e:room` (5/5 checks), `npm run pack -w @chirp/glasses` |
| Sound through the air | ✅ simulator, Mac speaker → Mac mic | [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) |
| Real glasses | ⏳ not tested | no device yet; the phone-mic fallback is built in |
| Tests | ✅ 110 passing in CI | [GitHub Actions](https://github.com/subheeksh5599/chirp/actions) |

## The 20-second pitch

Everyone building for glasses builds a feed: your messages, your prices, your inbox, on your lens. The glasses still can't take anything **in** from the room you're standing in. Chirp gives them that, with the one sense they have.

- **Hand-off.** Someone's phone chirps their card, and one tap connects you on Telegram. A host chirps a link on a voice call. A counter chirps a bill.
- **Broadcast.** A speaker's laptop chirps every 20 seconds. Every lens in the room follows the current slide, votes in live polls with a tap, and reads live subtitles.
- **Presence.** The room's code changes every 5 seconds. Hearing at least 3 of them across 10 minutes (the defaults) earns a signed presence record you can anchor on TON testnet.
- **Sync.** A stream host marks the market they're talking about. Viewers' lenses show it with live odds, and a double-tap opens a paper position.

Every one of those ends in your Telegram chat with the bot, and `/heard` keeps the day's list.

| The speaker console | Sharing a link |
|---|---|
| ![Speaker console on production: the lens preview shows the current slide exactly as listeners see it](docs/media/console.png) | ![Share-a-link page on production with the lens preview of the card](docs/media/link.png) |

Each sender page shows the lens text the server will send, rendered by the same function, so the preview can't drift from what wearers see.

## Table of contents

- [Live status](#live-status)
- [The 20-second pitch](#the-20-second-pitch)
- [Try it in five minutes](#try-it-in-five-minutes)
- [See it in one command](#-see-it-in-one-command)
- [What Chirp is NOT](#what-chirp-is-not)
- [The problem](#the-problem)
- [Why it's useful every day](#why-its-useful-every-day)
- [What I built](#what-i-built)
- [Architecture](#architecture)
- [The chirp, step by step](#the-chirp-step-by-step)
- [Where each guarantee is enforced](#where-each-guarantee-is-enforced)
- [What the sound measurements say](#what-the-sound-measurements-say)
- [On the lens](#on-the-lens)
- [Engineering decisions and the traps that taught me something](#engineering-decisions-and-the-traps-that-taught-me-something)
- [What's real: the status table](#whats-real-the-status-table)
- [Definition of done](#definition-of-done)
- [Attack → test](#attack--test)
- [Limitations](#limitations)
- [Security and privacy](#security-and-privacy)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Run it yourself](#run-it-yourself)
- [Tests](#tests)
- [Built on](#built-on)
- [License](#license)

## Try it in five minutes

**On the glasses (or the simulator):**
1. Install the build (`npm run pack -w @chirp/glasses` makes `chirp.ehpk`), or run it in the simulator with `npm run dev:glasses` and `evenhub-simulator http://localhost:5173`.
2. The lens shows **Chirp · pair your Telegram** and a 6-digit code. Send that code to [@Chirp567_bot](https://t.me/Chirp567_bot).
3. The lens switches to **Chirp · listening (glasses mic)**.

**Make something chirp near it:**
- **A talk:** open the [speaker console](https://chirp-liart-six-38.vercel.app/console.html), paste a few slides (`Poll: Ship weekly? | weekly | monthly` makes a poll), press **Start session**, then **Start chirping**. The lens shows the slide. Press **Next** and the lens follows. On a poll, tap the glasses to vote and watch the console count it. Press **End session and open claims**, and listeners who stayed long enough see **✓ You were here** and tap to claim.
- **A link on a call:** open [Share a link](https://chirp-liart-six-38.vercel.app/link.html), fill in a title and link, press **Chirp it** near the mic. Tap on the glasses and the link arrives in Telegram.
- **Your card:** in the bot, tap the **Chirp me** menu button and press **Chirp my card**. The other person's lens shows your name; their tap sends both of you a message.
- **A bill:** open [Counter bill](https://chirp-liart-six-38.vercel.app/shop.html), enter an amount in testnet TON, press **Create bill and chirp**. The wearer taps, confirms in a TON testnet wallet on their phone (Tonkeeper, MyTonWallet), and the counter page shows **Paid** and the explorer link.
- **A stream marker:** open [Stream markers](https://chirp-liart-six-38.vercel.app/marker.html), search `bitcoin`, press **Chirp** (or **Download** to mix it into a stream). The lens shows the market with live odds.

Then send `/heard` to the bot.

## ▶ See it in one command

Against production, no install:

```
$ curl -s https://chirp-liart-six-38.vercel.app/api/health
{"ok":true,"time":"2026-11-25T06:51:19.213Z"}
$ curl -s -X POST https://chirp-liart-six-38.vercel.app/api/sessions -H "content-type: application/json" -d '{"title":"Demo talk","slides":[{"title":"Hello room"}]}'
{"id":"HDBJMET4","adminSecret":"…"}
$ curl -s https://chirp-liart-six-38.vercel.app/api/sessions/HDBJMET4/admin -H "authorization: Bearer <adminSecret>" | jq -c '{listeners, chirp}'
{"listeners":0,"chirp":{"frame":"B5HP98WXY","slot":359117896,"validForMs":3618}}
```

`B5HP98WXY` is what the console turns into sound: `B` for broadcast, then the room code for that 5-second slot. It stops being accepted about 10 seconds later.

And the whole acoustic loop on your own machine (plays soft chirps through your speakers):

```
$ npm run e2e:room
✓ first launch shows a pairing code · 373236
✓ pairing is picked up by the lens
✓ a room chirp through the air opens the slide card · chirps needed: 4
✓ slide change reaches the lens without a new chirp · screenshot …/.artifacts/e2e-poll.png
✓ tapping the glasses votes in the poll · votes yes=1 no=0

5/5 checks passed
```

## What Chirp is NOT

- **Not a new modem.** Sending data as sound is old (dial-up, payment soundboxes, the open-source codec used here). The new part is using it as the receive channel a camera-less display device is missing, and building presence, broadcast and hand-off on top.
- **Not ultrasonic.** The glasses deliver 16 kHz audio, so anything above 8 kHz is invisible to them. The chirp is a soft, audible chime between 1.9 and 6.1 kHz.
- **Not a recorder.** Audio is decoded in memory and dropped. Only the 9-character code leaves the phone.
- **Not a wallet.** Chirp never holds funds or signs. Payments and anchors are testnet transactions the wearer confirms in their own wallet.
- **Not a feed.** It shows nothing until something in the room speaks to it.

## The problem

Glasses with a display already do messages, navigation, captions and AI answers. What they can't do is the most common hand-off in daily life: something near you wants to give you something. A QR code needs a camera. NFC needs a reader. Bluetooth discovery isn't exposed to apps. So the phone comes out, every time, which is the thing the glasses were supposed to stop.

## Why it's useful every day

| Everyday moment | How often | Who chirps | What the lens shows | One tap does |
|---|---|---|---|---|
| **Group voice chat or call** ("link's in the chat") | Daily for community members and remote teams | The host, from [Share a link](https://chirp-liart-six-38.vercel.app/link.html), phone near the mic | `Launch thread · from Host` | Saves the link to your Telegram |
| **Meeting someone** ("what's your Telegram?") | Several times a week | Their phone, from the **Chirp me** Mini App | `Sam · founder, Tidepool · @samreyes` | Both of you get a message; saved in `/met` |
| **Class, meetup or talk** ("scan before I change the slide") | Weekly, daily for students | The speaker console | Current slide, live poll, subtitles | Vote, save the deck, claim presence |
| **Stream or podcast** ("check the market I'm talking about") | Daily for viewers | Mixed into the stream audio | The market with live odds | Save it, or double-tap for a paper position |
| **Counter or stall** ("scan to pay") | Where crypto is accepted | The counter page | `Café Noor · 0.5 TON · testnet` | Opens the payment in the wearer's wallet |
| **Arriving somewhere** (Wi-Fi, menu) | Daily in offices and venues | A screen or speaker | `Office Wi-Fi · network Studio5 …` | Sends the details to Telegram |

Design rules that make it a habit rather than a demo:

1. **Every chirp ends in Telegram.** Links, contacts, decks, markets and bills land in your chat with the bot.
2. **`/heard`** lists everything your glasses caught in the last 24 hours.
3. **Anyone can send in 10 seconds.** Every sender is a web page or a Mini App; nothing to install.
4. **Missed it? It waits.** A card heard while another is up queues as `+1 heard · swipe for next`.
5. **One tap for the obvious action, double-tap for the other.** No menus, no dictation.
6. **Join late, still get it.** Every broadcast chirp carries the current state, and the lens keeps refreshing on its own once you've joined.

## What I built

| Piece | What it does |
|---|---|
| `apps/glasses` | The glasses app: 16 kHz mic → decoder → server → lens card; taps, ring, swipe, long press; pairing; queue; offline retry; glasses/phone mic switch |
| `apps/web` | Sender tools, each showing the exact lens text the server will send and the chirp's real waveform as it plays: speaker console (slides, polls, auto-chirp, live subtitles, end-and-claim), share-a-link, counter bill, stream markers with WAV export, the Telegram Mini App, a sound test, privacy policy |
| `server` | One HTTP API plus the Telegram bot: devices and pairing, rotating room codes, presence rule and signed records, hand-offs, markers, paper positions, `/heard`, `/met`, `/paper`, on-chain checks |
| `packages/wire` | Frame format, Crockford base32 codes, HMAC slot codes, presence rule, deck text format |
| `packages/sound` | Soft chirp shaping: fades, low-pass, two copies per chirp |

## Architecture

```
 sender (web page / Mini App / stream)        server (Vercel + Neon)                    glasses app (Even Hub WebView)
 ─────────────────────────────────────        ──────────────────────                    ───────────────────────────────
 ask for the current frame  ───────────────▶  HMAC(session key, slot) → "B" + code
 play soft chirp  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ sound through the air ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶  mic PCM 16 kHz → decode
                                              POST /api/heard ◀──────────────────────── 9-character frame
                                              verify slot ±1, record hearing
                                              lens card ───────────────────────────────▶ show it
                                              POST /api/act ◀───────────────────────── tap / double-tap
 Telegram message / Tonkeeper link ◀───────── bot sends the result
```

### HTTP surface

| Route | Who calls it | What it does |
|---|---|---|
| `GET /api/config` | glasses, web | The bot's username, read from Telegram with the server's token |
| `POST /api/devices` | glasses | New device token and 6-digit pairing code |
| `GET /api/devices/me` | glasses | Paired yet? |
| `POST /api/heard` | glasses | A decoded frame in, a lens card out |
| `POST /api/act` | glasses | Tap or double-tap on the current card |
| `GET /api/sessions/:id/state` | glasses | Live refresh for a room it has heard |
| `POST /api/sessions` | console | New session (slides, polls, presence rule) |
| `GET /api/sessions/:id/admin` | console | Current frame to chirp, listeners, votes, claims |
| `POST /api/sessions/:id/slide`, `/end`, `/caption` | console | Change slide, end and open claims, subtitles |
| `POST /api/handoff/connect`, `/bill`, `/link` | senders | One-off codes for a card, a bill, a link or note |
| `GET /api/pay/:id` | counter page | Has the testnet payment landed? |
| `GET /api/markets`, `POST /api/markers` | marker page | Live market search, stream marker codes |
| `GET /api/presence/:id` | anyone | The signed record, its signature check and anchor |
| `POST /api/telegram` | Telegram | Bot webhook (secret header required) |

## The chirp, step by step

1. **Frame.** 9 ASCII characters: a type (`B` broadcast, `H` hand-off, `S` stream marker) and an 8-character Crockford base32 code (40 bits). The codec adds its own Reed-Solomon error correction. Details: [docs/PROTOCOL.md](docs/PROTOCOL.md).
2. **Sound.** The codec's audible-normal mode, softened: 25 ms fades so there are no clicks, a 6.8 kHz low-pass, and two copies 250 ms apart so either one arriving is enough. Volume 12 (the sender pages allow 1 to 40).
3. **Hearing.** The glasses app feeds each mic audio event (about 100 ms of 16 kHz PCM) to the decoder and ignores the same text within 10 seconds.
4. **Resolving.** The server matches broadcast codes against every live session's key for the current slot and its neighbours; hand-off and marker codes are looked up and must not be expired.
5. **Card.** The server writes the words, wrapped to 40 columns, with a hint line (`tap: … · 2×tap: … · swipe: back`). The glasses only lay it out.
6. **Act.** A tap votes, connects, saves or claims; the bot delivers the result to Telegram.

## Where each guarantee is enforced

| Guarantee | Module | The test that covers it |
|---|---|---|
| Only the server can produce room codes | `packages/wire/src/code.ts` | `rejects a code made with the wrong key` |
| A recording stops working within seconds | `packages/wire/src/code.ts`, `server/sessions.ts` | `matches the current slot and ±1, but not ±2`, `rejects a recording of an old code and a forged code` |
| One shared code never proves presence | `packages/wire/src/presence.ts` | `one shared code never qualifies`, `one code shared in a chat does not qualify` |
| Presence records can't be edited | `server/crypto.ts` | `codes spread over the session qualify; a claim is signed and sent to Telegram` |
| Contact cards come from the real Telegram user | `server/telegram.ts` | `requires valid Telegram initData` |
| You can't connect with your own card; expired cards fail | `server/handoff.ts` | `your own card and expired cards are refused` |
| Payments go to the wallet with a unique comment and are only marked paid on-chain | `server/handoff.ts`, `server/ton.ts` | `tap sends a wallet link with a unique comment; unpaid until it is on-chain` |
| Only devices that heard the room can vote or read it | `server/sessions.ts` | `a device that never heard the room cannot vote or read its state` |
| Only the session owner controls it | `server/sessions.ts` | `only the owner can control a session` |
| A bad chirp never covers a good card | `apps/glasses/src/controller.ts` | `a bad chirp never covers a good card, and shows an error when nothing is up` |
| The chirp survives the 16 kHz mic path | `packages/sound/src/index.js` | `decodes real frames after softening and downsampling` |

## What the sound measurements say

Full tables and how to reproduce them: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

- **Offline, through a simulated 16 kHz mic path:** audible-normal decodes **100% down to 5 dB SNR and 95% at 0 dB**. Audible-fast holds up but drops to 80% at 0 dB; audible-fastest and every dual-tone mode decode 0%.
- **Band:** all of the chirp's energy sits between **1,875 and 6,094 Hz**.
- **Through codecs (offline, 20 codes each):** Opus voice at 24 kbps, AAC, MP3 and G.722 all carried **20/20**. Opus at 16 kbps with room noise carried **12/20**. An 8 kHz phone line carried **0/20**, because it stops at 4 kHz.
- **Through the air, worst case (laptop speaker into its own mic):** one copy decoded **60%** of the time. Two unsoftened copies at volume 20 decoded **18 of 20**; the shipped setting (two softened copies, volume 12) decoded **8 of 10**. A capture showed the laptop suppressing its own output as echo (chirps arrive with 22–26 dB SNR but cut short), which is why the sender should be a different device. Pauses between chirps made no difference.

## On the lens

```
Glasses talk · 2/3                         Sam
Poll · Ship weekly or monthly?             founder, Tidepool
                                           @samreyes
tap: weekly · 2×tap: monthly · swipe: back
                                           tap: connect · 2×tap: ignore · swipe: back
```

Real captures from the simulator (576×288, the G2 display):

| First launch: pairing | A poll slide, heard through the air | After a tap vote |
|---|---|---|
| ![Lens asking the wearer to send a 6-digit code to the bot](docs/media/lens-pairing.png) | ![Lens showing a poll slide](docs/media/lens-poll.png) | ![Lens showing the poll tally after a vote](docs/media/lens-voted.png) |

Root screen: `Chirp · listening (glasses mic)` · `hold: pause · swipe: mic · 2×tap: exit`. Double-tap on the root opens the system exit dialog.

## Engineering decisions and the traps that taught me something

- **The fastest codec modes don't survive 16 kHz.** Audible-fastest and the dual-tone modes decode 0% after downsampling, even with no noise; audible-fast is weaker at low SNR. The bench picked audible-normal before any UI existed.
- **Louder was not better.** With two softened copies, volume 20 and volume 12 both decoded 8 of 10 through the air, and 12 is about 4 dB quieter. Two copies per chirp helped more than any volume change.
- **A laptop can't test itself fairly.** Its echo suppression cuts the chirp short. The capture analyser (`scripts/analyze-capture.mjs`) proved it was the audio path, not the decoder.
- **A single press arrives without a type.** The SDK normalises the press event's type `0` to undefined and sends it as a system event, so the first tap test failed until the router treated "system event with a source and no type" as a press.
- **Repeated room codes keep counting while the lens shows something else.** The glasses report every chirp, even when the card is queued or the room was swiped away, because presence is the sum of hearings over time.
- **Tests run against the real database.** Each run creates a throwaway schema in Neon and drops it after, so the SQL, the constraints and the migrations are what's tested.

## What's real: the status table

| Item | Status | Proof |
|---|---|---|
| Codes decode from soft chirps through a 16 kHz path | ✅ | `packages/sound/test/sound.test.ts` |
| Chirp through the air opens a card in the simulator | ✅ | `npm run e2e:room`, [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) |
| Broadcast: slides follow live, tap-to-vote polls | ✅ | `server/test/server.test.ts`, `apps/glasses/test/controller.test.ts`, `npm run e2e:room` |
| Live subtitles via speech-to-text | ✅ | production `/api/sessions/:id/caption` returned the spoken sentence |
| Presence: rule, signed record, public verify route | ✅ | `server/test/server.test.ts` |
| Presence anchor on TON testnet | ✅ record `27VHDCYT`: 6 room codes heard through the air by the simulator, signed, [anchored](https://testnet.tonviewer.com/transaction/1b108fba9be25c9a0dfb20689ee197785000e637338c2024aeb7af889f67240b) | `npm run presence:live`, then `npm run testnet -- anchor <id>`; [`/api/presence/27VHDCYT`](https://chirp-liart-six-38.vercel.app/api/presence/27VHDCYT) shows `signatureValid: true` |
| Hand-off: contact cards, links, notes | ✅ | `server/test/server.test.ts` |
| Sender pages preview exactly what the lens shows | ✅ | `server/test/server.test.ts` (`the console shows the same text a listener gets, slide and poll`) |
| Bills on TON testnet | ✅ bill `DTJ5NFAM` paid 0.05 TON from a second wallet, [marked paid by production](https://testnet.tonviewer.com/transaction/aafb1ce339591ee6f2c621bad23b96d5c10202bb324085c11214501e276f1028) | `npm run testnet -- bill` |
| Stream markers with live odds, paper positions | ✅ | `server/test/server.test.ts` (live market data) |
| `/heard`, `/met`, `/paper` | ✅ | `server/test/server.test.ts` |
| Packs to `.ehpk` | ✅ | `npm run pack -w @chirp/glasses` |
| Real glasses microphone | ⏳ not tested | no device; phone-mic fallback built (swipe on the root screen) |
| Through call, stream and podcast codecs | ✅ 20/20 clean on every modern codec; 12/20 on 16 kbps Opus with room noise; 0/20 on an 8 kHz phone line | `npm run bench:channels`, [MEASUREMENTS §5](docs/MEASUREMENTS.md#5-through-call-and-stream-codecs-offline) |
| Phone as sender across a room | ⏳ not measured | `scripts/count-heard.mjs` counts each trial |
| Live call with the app's noise suppression | ⏳ not measured | needs two accounts on a call |
| Store icon (24×24, store pixel rules) | ✅ | `scripts/test/icon.test.ts` |
| Glasses reach only whitelisted origins | ✅ checked in CI | `scripts/test/whitelist.test.ts`, `npm run check:whitelist` |
| Spam chirps rate-limited, rejected codes logged | ✅ | `a device spamming chirps is slowed down; other devices are not`, `logs each rejected code with why it was refused` |
| Locked-phone behaviour | ⏳ needs a beta install on a device | |

## Definition of done

Checked only when true on a real run.

**Works end to end**
- [x] Broadcast (slides, live polls, subtitles), presence (rule, signed record), hand-off (contacts, links, bills), sync (markers, paper positions) all run against production services
- [x] Every heard item lands in Telegram and shows in `/heard`
- [x] Replay, forgery and single-shared-code attacks are refused by tests
- [x] Decode rates published through call, stream and podcast codecs ([measurements §5](docs/MEASUREMENTS.md#5-through-call-and-stream-codecs-offline))
- [ ] Decode rate published for a phone sender across a room
- [ ] Decode rate measured on a live call with the call app's noise suppression on
- [x] A bill paid on TON testnet ([bill `DTJ5NFAM`](https://testnet.tonviewer.com/transaction/aafb1ce339591ee6f2c621bad23b96d5c10202bb324085c11214501e276f1028)) and a presence record anchored ([record `27VHDCYT`](https://testnet.tonviewer.com/transaction/1b108fba9be25c9a0dfb20689ee197785000e637338c2024aeb7af889f67240b), [verify it](https://chirp-liart-six-38.vercel.app/api/presence/27VHDCYT))

**Ships like a real app**
- [x] Manifest valid: `com.subheeksh.chirp`, name "Chirp", `0.1.0`, `min_sdk_version` set, only used permissions; packs to `.ehpk`
- [x] No keys in the app; every call goes through the server, which sends CORS headers
- [x] First launch explains pairing on the lens; the device token is remembered
- [x] Root double-tap opens the system exit dialog (`shutDownPageContainer(1)`)
- [x] Privacy policy covers every permission and names the backend
- [ ] Locked-phone check on a beta install (needs a device)

**Honest and reproducible**
- [x] Tests pass in CI
- [x] Prior work listed under [Built on](#built-on)
- [ ] Demo video in this README

## Attack → test

| The abuse | The answer |
|---|---|
| Record the room's chirp and replay it tomorrow | Old slot rejected: `rejects a recording of an old code and a forged code` |
| Post one room code in a group chat for everyone | One code never qualifies: `one shared code never qualifies` |
| Forge a room code | No session key, no valid code: `rejects a code made with the wrong key` |
| Edit a presence record to claim more minutes | Signature fails: `codes spread over the session qualify; a claim is signed and sent to Telegram` |
| Fake someone's contact card | Mini App initData must be signed by Telegram: `requires valid Telegram initData` |
| Vote without being in the room | `a device that never heard the room cannot vote or read its state` |
| Take over someone's talk | Admin secret required: `only the owner can control a session` |
| Spam the bot webhook | Secret header required: `health, 404 and auth errors` |

## Limitations

- **Livestream leakage.** Someone watching a low-delay live stream of the room hears the codes too. Slot tolerance is ±1 (about 10 seconds), which normal stream delay usually exceeds, but not always.
- **Audible.** Every chirp is a short, soft chime. Fine in talks and streams; it shouldn't repeat often.
- **Senders opt in.** Speakers, hosts and shops choose to chirp. Public spaces are later.
- **Real glasses untested.** The glasses mic path may process audio differently from the simulator. The phone-mic fallback is one swipe away.
- **Through-the-air numbers so far come from the worst case** (a laptop into its own mic). A second device as sender is the next measurement.

## Security and privacy

- Mic audio stays in memory and is dropped after decoding; only 9-character codes leave the phone. Long press pauses listening.
- Device tokens are random, stored hashed (SHA-256); session admin secrets the same.
- Presence records are ed25519-signed over canonical JSON and name the holder only by a one-way pseudonym.
- No keys ship in the glasses app; every third-party call goes through the server.
- Money is TON testnet only, confirmed in the wearer's own wallet. Paper positions are not trades.
- Privacy policy: [chirp-liart-six-38.vercel.app/privacy.html](https://chirp-liart-six-38.vercel.app/privacy.html).

## Tech stack

TypeScript everywhere · Even Hub SDK 0.0.16 · Vite · ggwave (data over sound, WASM) · Vercel functions · Neon Postgres · Telegram Bot API and Mini Apps · TON testnet (toncenter, Tonkeeper links) · public prediction-market data · Groq speech-to-text · Vitest · GitHub Actions.

## Project layout

```
apps/glasses/        glasses app (controller, decoder, SDK wiring) + controller tests
apps/web/            sender tools and the Mini App
server/              API router, bot, sessions, hand-offs, markers, presence + tests
api/index.ts         Vercel entry
packages/wire/       frames, codes, presence rule, deck format + tests
packages/sound/      soft chirp shaping + codec tests
scripts/             codec bench, acoustic e2e, capture analysis, setup
docs/                plan, roadmap, protocol, measurements
```

## Run it yourself

**You need:** Node 24, a Postgres database (a free Neon project works), a Telegram bot token from @BotFather, a public HTTPS URL for the bot webhook (your deployment, or a tunnel to `:8787`), the Even Hub tools (`npm i -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator`), and ffmpeg for `bench:channels` only.

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | everything, including tests (they use a throwaway schema) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PUBLIC_URL` | pairing and every Telegram message |
| `PRESENCE_SIGNING_KEY` | signing presence records |
| `TON_WALLET_ADDRESS` | bills and anchors (testnet) |
| `GROQ_API_KEY` | live subtitles only |
| `TONCENTER_API_KEY` | optional, raises toncenter's rate limit |
| `TON_PAYER_MNEMONIC` | optional, written by `npm run payer -- new` for scripted testnet runs |

`npm run dev:glasses` proxies `/api` to the local API on `:8787`, so pairing works against your own bot. To pair with the production bot instead, run it with `VITE_API_BASE=https://chirp-liart-six-38.vercel.app`.

```bash
npm ci
cp .env.example .env          # fill in the values
npm run setup                 # create tables, point the bot at PUBLIC_URL
npm run dev:api               # API on :8787
npm run dev:web               # sender tools on :5174 (proxies /api)
npm run dev:glasses           # glasses app on :5173
evenhub-simulator http://localhost:5173
npm test                      # 110 tests (server tests use a throwaway schema)
npm run e2e:room              # full acoustic loop in the simulator (plays sound)
npm run bench:codec           # codec decode rates at 16 kHz with noise
npm run bench:channels        # decode rates through call, stream and podcast codecs (needs ffmpeg)
npm run check:whitelist       # the glasses build reaches only the manifest's whitelisted origins
npm run icon                  # regenerate the store icon (apps/glasses/icon.png)
npm run payer -- new          # testnet-only payer wallet, mnemonic kept in .env (fund it with `acton wallet airdrop` or @testgiver_ton_bot)
npm run testnet -- bill       # issue a bill on prod, pay it from the payer, wait until prod sees it
npm run presence:live         # a real session on prod, room codes played into the simulator, claim tapped
npm run testnet -- anchor <id> # pay a presence record's anchor and run the bot's own check
```

The glasses app reads its server address from `VITE_API_BASE` (`apps/glasses/.env.production` for builds). Deploying: `npx vercel deploy --prod` with the same variables set in the Vercel project.

## Tests

| Suite | Tests |
|---|---|
| `server/test/server.test.ts` | 39 |
| `packages/wire/test/wire.test.ts` | 19 |
| `packages/wire/test/properties.test.ts` | 13 |
| `apps/glasses/test/controller.test.ts` | 9 |
| `packages/sound/test/soften.test.ts` | 7 |
| `scripts/test/whitelist.test.ts` | 5 |
| `scripts/test/icon.test.ts` | 4 |
| `packages/sound/test/sound.test.ts` | 4 |
| `packages/wire/test/deck.test.ts` | 4 |
| `scripts/test/privacy.test.ts` | 3 |
| `apps/web/test/envelope.test.ts` | 3 |
| **Total** | **110** |

The property tests draw hundreds of random codes, mutations and hearing patterns per rule from a fixed seed, so a failure repeats. Server and controller tests run against the real database in a throwaway schema, and the market and testnet tests call the live public APIs. Telegram messages in tests are recorded instead of sent, because the test users don't exist; production always sends.

## Built on

None of Chirp's code existed before 2026-11-23. It uses: [ggwave](https://github.com/ggerganov/ggwave) (MIT) for data over sound, the Even Hub SDK, CLI and simulator, `@neondatabase/serverless`, the Telegram Bot API and Mini App script, toncenter's public testnet API, Tonkeeper transfer links, public prediction-market data, and Groq's Whisper endpoint.

## License

MIT, see [LICENSE](LICENSE).

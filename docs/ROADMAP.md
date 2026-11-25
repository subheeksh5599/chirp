# Chirp: roadmap

Status updated 2026-11-25. Each phase ends with something real running. A phase is done only when its "Done means" line is true and the README status table is updated with evidence.

## Phase 0: prove the sound path

**Status: partly done.** Codec table and air test in [MEASUREMENTS](MEASUREMENTS.md) §1–§4; `scripts/e2e-room.ts` plays room codes from the Mac speaker into the simulator. The air test was a laptop into its own mic, not across a room; distances of 1, 3 and 5 m with a phone sender are not measured yet.

- Glasses app skeleton in the simulator: mic on, PCM in, decoded text on the lens.
- Test sender page that chirps a fixed string.
- Measure the decode rate per codec mode at 16 kHz input, at 1, 3 and 5 m, quiet vs chatter.

**Done means:** a laptop speaker chirps across the room and the simulator lens shows the decoded string, with decode rates recorded in a table.

## Phase 1: wire format and server

**Status: done.** `packages/wire` (36 tests), `POST /api/heard`, old-slot and forged codes refused (`rejects a recording of an old code and a forged code`).

- `packages/wire`: frame (the codec's Reed-Solomon does error correction), HMAC code derivation, slot maths, with test vectors.
- Server: sessions, `POST /heard`, code verification, health.
- Glasses app: decode, report to the server, show the server's lens state.

**Done means:** a code chirped from the test page is verified by the server and the lens shows its response. An old-slot code is rejected.

## Phase 2: Broadcast (lead)

**Status: done in the simulator.** `scripts/e2e-room.ts` checks that the lens follows the slides and that a tap records a vote. A room with three real wearers has not happened (one simulator, no glasses).

- Speaker console: start a session, load the deck, set a poll per slide, run the chirp timer.
- Lens follows the current slide, polls are voted by tap, and the console shows live results.
- Telegram pairing for the wearer.

**Done means:** a real session where the lens follows the slides and three real votes appear on the console.

## Phase 3: Presence

**Status: done except the testnet anchor.** Signed records and the shared-code refusal are tested (`codes spread over the session qualify; a claim is signed and sent to Telegram`, `one code shared in a chat does not qualify`). The anchor transfer is scripted (`npm run testnet -- anchor <id>`) and waits on a funded payer wallet.

- Presence rule (several codes spread across the session) with unit tests.
- Claim on the lens, and a signed presence record delivered through the bot.
- Optional testnet anchor: the tap opens a testnet transaction on the phone wallet against a presence contract.

**Done means:** a wearer present for the session claims and receives the record, the anchor transaction is confirmed on testnet with the link in the README, and a single shared code is refused.

## Phase 4: Hand-off

**Status: done in tests and on prod; two real accounts not connected yet.** Contacts, links and bills pass server tests against the real database. A paid bill is scripted (`npm run testnet -- bill`) and waits on a funded payer wallet.

- Telegram Mini App sender for cards.
- Tap sends the intro and saves the contact (`/met`).
- Counter bill: card, then testnet payment link on the phone wallet.

**Done means:** two real Telegram accounts connect through one chirp and one tap, and one real testnet payment for the exact amount is confirmed.

## Phase 5: Sync

**Status: done offline.** Markers carry live Polymarket odds (`a stream marker shows the market; tap saves it, double-tap opens a paper position`). The codec bench shows markers survive stream and podcast codecs ([MEASUREMENTS](MEASUREMENTS.md) §5). Not yet tried on a live stream.

- Livestream marker tool: tag a moment and mix the chirp into the stream audio.
- Lens shows the matching live item (for example a prediction market's odds, with a paper-bet tap).

**Done means:** a real stream carries a marker, and a viewer's lens opens the matching live market at that moment.

## Phase 6: hardening

**Status: done except one number.** Every row in [PLAN.md](PLAN.md) §5 maps to a test, including the per-device rate limit and the rejected-code log. Subtitles run through Groq. Hold pauses listening. The delay of a real livestream was not measured; the limit is documented in the README.

- Replay and forgery tests, rate limits, and the livestream limit documented with measured stream delay.
- Live subtitles for broadcast sessions.
- Long-press pause and the listening indicator, with errors that name the real cause.

**Done means:** every security row in PLAN.md has a test, and the measured numbers are published in the README.

## Phase 7: ship

**Status: partly done.** The `.ehpk` packs, the store icon is generated and tested, CI checks the network whitelist. Still open: the demo video and a check on real glasses.

- Packaged glasses build.
- README with setup, measured numbers, and a short video in the README showing broadcast, presence, hand-off and sync on real accounts.
- Honest status: simulator-verified vs real-glasses-verified.

**Done means:** a fresh clone runs by following the README, and every claim in it has evidence.

## Later
- Public-space senders (stations, venues) via venue partners.
- The wearer's own phone chirping back (two-way handshakes).
- Multi-language subtitle channels per session.

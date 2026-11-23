# Chirp: roadmap

Each phase ends with something real running. A phase is done only when its "Done means" line is true and the README status table is updated with evidence.

## Phase 0: prove the sound path
- Glasses app skeleton in the simulator: mic on, PCM in, decoded text on the lens.
- Test sender page that chirps a fixed string.
- Measure the decode rate per codec mode at 16 kHz input, at 1, 3 and 5 m, quiet vs chatter.

**Done means:** a laptop speaker chirps across the room and the simulator lens shows the decoded string, with decode rates recorded in a table.

## Phase 1: wire format and server
- `packages/wire`: frame, CRC, HMAC code derivation, slot maths, with test vectors.
- Server: sessions, `POST /heard`, code verification, health.
- Glasses app: decode, report to the server, show the server's lens state.

**Done means:** a code chirped from the test page is verified by the server and the lens shows its response. An old-slot code is rejected.

## Phase 2: Broadcast (lead)
- Speaker console: start a session, load the deck, set a poll per slide, run the chirp timer.
- Lens follows the current slide, polls are voted by tap, and the console shows live results.
- Telegram pairing for the wearer.

**Done means:** a real session where the lens follows the slides and three real votes appear on the console.

## Phase 3: Presence
- Presence rule (several codes spread across the session) with unit tests.
- Claim on the lens, and a signed presence record delivered through the bot.
- Optional testnet anchor: the tap opens a testnet transaction on the phone wallet against a presence contract.

**Done means:** a wearer present for the session claims and receives the record, the anchor transaction is confirmed on testnet with the link in the README, and a single shared code is refused.

## Phase 4: Hand-off
- Telegram Mini App sender for cards.
- Tap sends the intro and saves the contact (`/met`).
- Counter bill: card, then testnet payment link on the phone wallet.

**Done means:** two real Telegram accounts connect through one chirp and one tap, and one real testnet payment for the exact amount is confirmed.

## Phase 5: Sync
- Livestream marker tool: tag a moment and mix the chirp into the stream audio.
- Lens shows the matching live item (for example a prediction market's odds, with a paper-bet tap).

**Done means:** a real stream carries a marker, and a viewer's lens opens the matching live market at that moment.

## Phase 6: hardening
- Replay and forgery tests, rate limits, and the livestream limit documented with measured stream delay.
- Live subtitles for broadcast sessions.
- Long-press pause and the listening indicator, with errors that name the real cause.

**Done means:** every security row in PLAN.md has a test, and the measured numbers are published in the README.

## Phase 7: ship
- Packaged glasses build.
- README with setup, measured numbers, and a short video in the README showing broadcast, presence, hand-off and sync on real accounts.
- Honest status: simulator-verified vs real-glasses-verified.

**Done means:** a fresh clone runs by following the README, and every claim in it has evidence.

## Later
- Public-space senders (stations, venues) via venue partners.
- The wearer's own phone chirping back (two-way handshakes).
- Multi-language subtitle channels per session.

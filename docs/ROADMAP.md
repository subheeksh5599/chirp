# Chirp: roadmap

Each phase ends with something real running. A phase is done only when its "Done means" line is true and the README status table is updated with evidence.

## Phase 0: prove the sound path
- Glasses app skeleton in the simulator: mic on, PCM in, show the decoded text on the lens.
- Sender test page that chirps a fixed test string.
- Pick the codec protocol by measuring decode rate at 16 kHz input.

**Done means:** a phone chirps next to the laptop and the simulator lens shows the decoded string. Decode rate at 1 m is recorded.

## Phase 1: tokens and backend
- `packages/wire` payload format plus CRC, with unit tests.
- Server: beacons, short-lived tokens, resolve, health.
- Glasses app: decode, then resolve, then show the card.

**Done means:** a token chirped from the sender resolves to a server-issued card on the lens, and an expired token is rejected.

## Phase 2: Connect (lead flow)
- Telegram bot, pairing code, Mini App sender with the person's own card.
- Tap runs the action: the intro message goes to the other person, and the contact is saved with place and time.
- `/met` list in the bot.

**Done means:** two real Telegram accounts connect through a chirp and a single tap, and the message is visible in Telegram.

## Phase 3: Talk
- Web sender for speakers: slides URL plus channel, chirping on a button or on a repeat.
- Tap delivers the slides link and the channel invite to the wearer.

**Done means:** the speaker page chirps once and the wearer receives the links in Telegram.

## Phase 4: Pay (testnet)
- Shop web sender: amount plus memo.
- Card shows the shop, amount and memo. Tap opens the testnet payment link on the phone wallet.

**Done means:** a real testnet payment for the exact amount, confirmed in the wallet, with the transaction linked.

## Phase 5: hardening
- Replay rejection, resolve rate limiting, fake-chirp handling.
- Noise and distance measurements in a table in the README.
- Long-press pause and the listening indicator.
- Errors that name the real cause on the lens.

**Done means:** every security row in PLAN.md has a test, and the measured decode rates are published.

## Phase 6: ship
- Packaged glasses build.
- README with setup, the measured numbers, and a short demo video placed in the README itself.
- Honest status table: simulator-verified vs real-glasses-verified.

**Done means:** a fresh clone runs by following the README, and the video shows all three flows on real accounts.

## Later
- Sending from the glasses side (the wearer's phone chirps their own card).
- Multi-room talks with per-session channels.
- More payment rails.

# Chirp: sound frame

> Draft. Field sizes are fixed once phase 0 measures what decodes reliably at 16 kHz.

## Constraints
- The receiver samples at **16 kHz**, so every tone must sit below 8 kHz.
- Shorter is better: every byte adds air time and error risk. The target chirp is under 2 s.
- It has to survive room acoustics and, for sync, stream audio compression.

## Frame (8 bytes)

| Byte | Field | Notes |
|---|---|---|
| 0 | `version` (4 bits) + `type` (4 bits) | types: `1` broadcast/presence, `2` hand-off, `3` sync marker |
| 1–5 | `code` | 40 bits; meaning depends on the type (below) |
| 6 | `aux` | broadcast: slide number · sync: marker index · hand-off: 0 |
| 7 | `crc8` | over bytes 0–6 |

### Code by type
- **Broadcast / presence:** `code = truncate(HMAC-SHA256(session_key, slot), 40)`, where `slot = floor(unix_ms / 5000)`. The server accepts the slot ±1 to absorb clock drift.
- **Hand-off:** a random 40-bit token issued by the server, live for 60 s.
- **Sync marker:** a random 40-bit token for each marker, live for the stream's duration.

## Decode rules (glasses side)
1. Unknown version: ignore.
2. CRC fail: ignore and count it (feeds the noise measurements).
3. The same `(type, code)` within 10 s counts once.
4. Report `(frame, device_time)` to `POST /heard`, and show whatever the server returns.
5. If the server is unreachable, keep up to 50 frames in memory and retry, showing `offline · will retry` on the lens.

## Presence rule (server side, default)
- At least **3** valid broadcast codes,
- from slots spread across at least **10 minutes** of the session,
- from one paired device.

Organisers can make it stricter (more codes, a longer span).

## Open
- Codec mode choice (speed vs robustness), measured in phase 0.
- Whether broadcast frames need a preamble so the glasses can lock on in noisy rooms.
- Whether 40 bits fit the air-time target. If not, find the smallest length that keeps guessing infeasible within one slot.

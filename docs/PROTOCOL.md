# Chirp: sound payload

> Draft. Field sizes are fixed once phase 0 measures what decodes reliably at 16 kHz.

## Constraints
- The receiver samples at **16 kHz**, so every tone must sit below 8 kHz.
- Short is better: every extra byte adds air time and a chance of error. The target chirp is under 2 s.

## Frame (8 bytes)

| Byte | Field | Notes |
|---|---|---|
| 0 | `version` | `0x01` |
| 1 | `type` | `0x01` connect, `0x02` talk, `0x03` pay |
| 2–6 | `token` | 40 random bits, issued by the server, live for 60 s |
| 7 | `crc8` | over bytes 0–6 |

- The token is the only secret-ish part, and it is useless once it expires.
- The type lets the glasses show the right placeholder ("connecting…", "paying…") before the resolve returns.

## Decode rules
1. Wrong version: ignore silently.
2. CRC fail: ignore silently and count it (used in the noise measurements).
3. The same token decoded twice within 10 s counts as one event.
4. Resolve fails: show the server's reason on the lens.

## Open
- The codec protocol choice (speed vs robustness) is decided by phase 0 measurement.
- Whether a repeating beacon (Talk) needs a preamble the glasses can lock onto.

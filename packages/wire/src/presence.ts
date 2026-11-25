// Presence rule: being in the room for a stretch, not holding one shared code.
import { SLOT_MS } from './code.js';

export type PresenceRule = { minCodes: number; minMinutes: number };
export const DEFAULT_RULE: PresenceRule = { minCodes: 3, minMinutes: 10 };

export type PresenceResult = {
  ok: boolean;
  codes: number;
  spanMinutes: number;
  reason?: string;
};

/** `slots` are the distinct verified slots one device heard in one session. */
export function evaluatePresence(slots: number[], rule: PresenceRule = DEFAULT_RULE): PresenceResult {
  const uniq = [...new Set(slots)].sort((a, b) => a - b);
  const codes = uniq.length;
  const spanMinutes = codes < 2 ? 0 : ((uniq[codes - 1] - uniq[0]) * SLOT_MS) / 60_000;
  if (codes < rule.minCodes) {
    return { ok: false, codes, spanMinutes, reason: `heard ${codes} of ${rule.minCodes} codes needed` };
  }
  if (spanMinutes < rule.minMinutes) {
    return {
      ok: false,
      codes,
      spanMinutes,
      reason: `codes span ${spanMinutes.toFixed(1)} of ${rule.minMinutes} minutes needed`,
    };
  }
  return { ok: true, codes, spanMinutes };
}

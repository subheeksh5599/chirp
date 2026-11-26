// What the glasses show. The server decides the words; the glasses only lay them out.
export type Ref = { type: 'session' | 'presence' | 'handoff' | 'marker' | 'contact' | 'note'; id: string };

export type Card = {
  kind: 'slide' | 'poll' | 'presence' | 'connect' | 'connected' | 'draft' | 'pay' | 'link' | 'market' | 'info' | 'error';
  ref?: Ref;
  lines: string[];
  /** Label for one tap; absent means tap does nothing on this card. */
  tap?: string;
  /** Label for a double tap. */
  double?: string;
  /** Label for press-and-hold to record a voice note; absent means holding pauses listening as usual. */
  voice?: string;
  /** While true, the glasses keep this card fresh by polling the session state. */
  live?: boolean;
};

export const LENS_COLS = 40;
export const MAX_LINES = 5;

/** Word-wrap to the lens width, hard-cutting words longer than a line. */
export function wrap(text: string, cols = LENS_COLS, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > cols) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= cols ? `${last.slice(0, cols - 1)}…` : `${last}…`;
    return kept;
  }
  return lines;
}

export const clip = (s: string, n = LENS_COLS) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * Characters the G2 lens font can draw: printable ASCII plus the few symbols the hints use.
 * The simulator logs "glyph dsc. not found" for anything else (✓ was the first one caught).
 */
export const LENS_GLYPHS = /^[\x20-\x7E·×…]*$/;
const SUBSTITUTE: Record<string, string> = { '“': '"', '”': '"', '‘': "'", '’': "'", '—': '-', '–': '-', '✓': '', '→': '>' };

/** Rewrite text into characters the lens font has: accents dropped (é → e), anything else unknown becomes '?'. */
export function lensSafe(text: string): string {
  return [...text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]
    .map((c) => (LENS_GLYPHS.test(c) ? c : (SUBSTITUTE[c] ?? (/\s/.test(c) ? ' ' : '?'))))
    .join('')
    .replace(/^ +/, '');
}

/** Final lens text: content lines plus one hint line. */
export function render(card: Card): string {
  const body = card.lines.slice(0, MAX_LINES).map((l) => clip(lensSafe(l)));
  const hints = [card.tap && `tap: ${card.tap}`, card.double && `2×tap: ${card.double}`, card.voice && `hold: ${card.voice}`, 'swipe: back']
    .filter((h): h is string => !!h)
    .map(lensSafe);
  // Hints that don't fit on one line wrap at a ' · ' boundary rather than losing the last one.
  const hintLines: string[] = [];
  for (const h of hints) {
    const last = hintLines.length - 1;
    if (last >= 0 && hintLines[last].length + 3 + h.length <= LENS_COLS + 12) hintLines[last] += ` · ${h}`;
    else hintLines.push(h);
  }
  return [...body, '', ...hintLines.slice(0, 2).map((l) => clip(l, LENS_COLS + 12))].join('\n');
}

export const errorCard = (...lines: string[]): Card => ({ kind: 'error', lines });
export const infoCard = (...lines: string[]): Card => ({ kind: 'info', lines });

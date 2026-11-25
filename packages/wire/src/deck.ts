// Plain-text deck format used by the speaker console, one slide per line:
//   Slide title | optional note
//   Poll: question | option A | option B
// Blank lines and lines starting with # are ignored.
export type DeckSlide = { title: string; note?: string; poll?: { question: string; a: string; b: string } };

export class DeckError extends Error {
  constructor(public line: number, message: string) {
    super(`line ${line}: ${message}`);
  }
}

export function parseDeck(text: string): DeckSlide[] {
  const slides: DeckSlide[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const n = i + 1;
    const poll = /^poll\s*:\s*(.*)$/i.exec(line);
    if (poll) {
      const parts = poll[1].split('|').map((s) => s.trim());
      if (parts.length !== 3 || parts.some((p) => !p)) throw new DeckError(n, 'a poll needs "question | option A | option B"');
      const [question, a, b] = parts;
      if (a.length > 24 || b.length > 24) throw new DeckError(n, 'poll options must be 24 characters or fewer');
      slides.push({ title: question, poll: { question, a, b } });
      return;
    }
    const [title, ...rest] = line.split('|').map((s) => s.trim());
    if (!title) throw new DeckError(n, 'slide title is empty');
    const note = rest.join(' | ').trim();
    slides.push(note ? { title, note } : { title });
  });
  if (!slides.length) throw new DeckError(0, 'add at least one slide');
  return slides;
}

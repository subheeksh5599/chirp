import { describe, expect, it } from 'vitest';
import { DeckError, parseDeck } from '../src/deck.js';

describe('deck text format', () => {
  it('parses slides, notes and polls', () => {
    const deck = parseDeck(`
      # comments are ignored
      Why glasses need ears | no camera, no NFC
      Poll: Ship weekly or monthly? | weekly | monthly

      Thanks
    `);
    expect(deck).toEqual([
      { title: 'Why glasses need ears', note: 'no camera, no NFC' },
      { title: 'Ship weekly or monthly?', poll: { question: 'Ship weekly or monthly?', a: 'weekly', b: 'monthly' } },
      { title: 'Thanks' },
    ]);
  });
  it('keeps extra pipes inside the note', () => {
    expect(parseDeck('A | b | c')).toEqual([{ title: 'A', note: 'b | c' }]);
  });
  it('reports the failing line', () => {
    expect(() => parseDeck('ok\nPoll: only a question')).toThrow(/line 2/);
    expect(() => parseDeck('Poll: q | a | ' + 'x'.repeat(30))).toThrow(DeckError);
    expect(() => parseDeck('   \n# nothing')).toThrow(/at least one slide/);
    expect(() => parseDeck('| just a note')).toThrow(/title is empty/);
  });
  it('is case-insensitive about the poll prefix', () => {
    expect(parseDeck('POLL: q | y | n')[0].poll).toEqual({ question: 'q', a: 'y', b: 'n' });
  });
});

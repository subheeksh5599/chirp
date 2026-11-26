import { describe, expect, it } from 'vitest';
import { pcmToWav, toBase64 } from '../src/controller';

describe('note audio', () => {
  it('wraps 16 kHz mono PCM in a WAV header the speech service reads', () => {
    const wav = pcmToWav([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5, 6])]);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe('WAVEfmt ');
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(6);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('base64 matches Node for a buffer larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GRID, renderIcon } from '../make-icon.mjs';

/** Decode the PNGs our encoder writes: one IDAT, RGBA 8-bit, filter 0 rows. */
function decode(png: Buffer) {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  let off = 8;
  let width = 0, height = 0, colorType = -1;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString();
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') [width, height, colorType] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9]];
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  expect(colorType).toBe(6);
  const raw = inflateSync(Buffer.concat(idat));
  const px = (x: number, y: number) => {
    const i = y * (width * 4 + 1) + 1 + x * 4;
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    return [...raw.subarray(i, i + 4)];
  };
  return { width, height, px };
}

describe('store icon', () => {
  const committed = readFileSync('apps/glasses/icon.png');

  it('the committed icon is exactly what the script renders', () => {
    expect(Buffer.compare(committed, renderIcon())).toBe(0);
  });

  it('is 24x24 and every pixel is transparent or opaque #F4F4F4', () => {
    const { width, height, px } = decode(committed);
    expect([width, height]).toEqual([24, 24]);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const p = px(x, y);
        expect(p[3] === 0 || p.join() === '244,244,244,255', `pixel ${x},${y} is ${p}`).toBe(true);
      }
  });

  it('lit pixels form raster-aligned 2x2 blocks, as the store scans them', () => {
    const { px } = decode(committed);
    const lit = (x: number, y: number) => px(x, y)[3] === 255;
    const used = new Set<string>();
    let blocks = 0;
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        if (!lit(x, y) || used.has(`${x},${y}`)) continue;
        expect(x < 23 && y < 23, `lit pixel ${x},${y} sits on the last row or column`).toBe(true);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          expect(lit(x + dx, y + dy), `block at ${x},${y} is missing ${x + dx},${y + dy}`).toBe(true);
          used.add(`${x + dx},${y + dy}`);
        }
        blocks++;
      }
    expect(blocks).toBe(GRID.join('').split('#').length - 1);
  });

  it('each grid cell becomes one aligned 2x2 block', () => {
    const bad = [...GRID];
    bad[0] = '#...........';
    const png = renderIcon(bad);
    const { px } = decode(png);
    expect(px(0, 0)[3]).toBe(255);
    expect(px(1, 1)[3]).toBe(255);
  });
});

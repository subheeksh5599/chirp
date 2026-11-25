// Writes apps/glasses/icon.png to the store's icon rules (evenhub CLI README, "Icon rules"):
// 24x24, every pixel transparent or opaque #F4F4F4, lit pixels in raster-aligned 2x2 blocks.
// The design is a 12x12 grid below; each cell becomes one 2x2 block. Run: node scripts/make-icon.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// A dot (the speaker) with three sound arcs opening to the right.
export const GRID = [
  '............',
  '......#.....',
  '...#...#....',
  '....#...#...',
  '.#...#..#...',
  '##...#...#..',
  '##...#...#..',
  '.#...#..#...',
  '....#...#...',
  '...#...#....',
  '......#.....',
  '............',
];

export const LIT = [0xf4, 0xf4, 0xf4, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA PNG, 8 bits per channel, filter type 0 on every row. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderIcon(grid = GRID) {
  const size = grid.length * 2;
  const px = Buffer.alloc(size * size * 4);
  grid.forEach((row, gy) =>
    [...row].forEach((cell, gx) => {
      if (cell !== '#') return;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) px.set(LIT, ((gy * 2 + dy) * size + gx * 2 + dx) * 4);
    }),
  );
  return encodePng(size, size, px);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('apps/glasses/icon.png', renderIcon());
  console.log('wrote apps/glasses/icon.png');
}

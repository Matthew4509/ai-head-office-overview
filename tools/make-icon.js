// Draws the office icon (a desk with a screen and a person at it, on a blue rounded square: the page's icon.svg)
// and writes office/public/app.ico with 16, 24, 32, 48, 64 and 256 px images. No packages: shapes are drawn with 4x4
// supersampling, stored as 32-bit BMPs.
// Run: node tools/make-icon.js   (the .ico is committed, so this only needs running if the design changes)
'use strict';
const fs = require('fs');
const path = require('path');

const BLUE = [0x24, 0x57, 0xd6], WHITE = [255, 255, 255], SCREEN = [0xcf, 0xe0, 0xff], FACE = [0xff, 0xd2, 0x7a];

// Shapes in a 64x64 design space: icon.svg's 32x32 drawing, twice the size.
function coverage(x, y) {
  const round = (x0, y0, w, h, r) => { // inside a rounded rectangle
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r), cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  if (!round(4, 4, 56, 56, 12)) return null;
  if (round(14, 34, 36, 8, 2)) return WHITE; // the desk
  if (round(22, 18, 20, 14, 2)) return SCREEN; // the screen
  if ((x - 32) ** 2 + (y - 50) ** 2 <= 25) return FACE; // the person
  return BLUE;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4); // BGRA, bottom-up rows (BMP order)
  const S = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = coverage((x + (sx + 0.5) / S) * 64 / size, (y + (sy + 0.5) / S) * 64 / size);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = ((size - 1 - y) * size + x) * 4;
    if (a) { px[o] = Math.round(b / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(r / a); }
    px[o + 3] = Math.round(255 * a / (S * S));
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(0, 16);
  header.writeUInt32LE(px.length, 20);
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, px, Buffer.alloc(maskRow * size)]); // AND mask all zero: alpha does the work
}

const sizes = [16, 24, 32, 48, 64, 256];
const images = sizes.map(render);
const dir = Buffer.alloc(6 + 16 * sizes.length);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
let offset = dir.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  dir.writeUInt8(s === 256 ? 0 : s, e); dir.writeUInt8(s === 256 ? 0 : s, e + 1);
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(images[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
const out = path.join(__dirname, '..', 'office', 'public', 'app.ico');
fs.writeFileSync(out, Buffer.concat([dir, ...images]));
console.log('wrote ' + out + ' (' + Math.round(offset / 1024) + ' KB, ' + sizes.join('/') + ' px)');

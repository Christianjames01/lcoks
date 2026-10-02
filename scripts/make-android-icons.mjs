// Generates the monochrome padlock launcher icons and splash screens for the
// Android project (android/app/src/main/res). Dependency-free PNG encoder.
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RES = 'android/app/src/main/res';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (t, d) => {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
};
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - hw + r;
  const dy = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
}
function lock(x, y) {
  const cx = 0.5, cy = 0.4, R = 0.165, T = 0.055;
  let shackle = false;
  if (y <= cy) shackle = Math.abs(Math.hypot(x - cx, y - cy) - R) <= T / 2;
  else if (y <= 0.52) shackle = Math.abs(Math.abs(x - cx) - R) <= T / 2;
  const body = sdRoundRect(x, y, 0.5, 0.635, 0.24, 0.18, 0.04) <= 0;
  const hole = Math.hypot(x - 0.5, y - 0.6) <= 0.042 || (Math.abs(x - 0.5) <= 0.018 && y >= 0.6 && y <= 0.7);
  return (shackle || body) && !hole;
}

/**
 * w×h image; the lock occupies a centred square of side `scale * min(w,h)`.
 * bg: 'none' | 'square' (black fill) | 'circle' (black circle).
 */
function render(w, h, { scale = 1, bg = 'none' } = {}) {
  const out = Buffer.alloc(w * h * 4);
  const side = Math.min(w, h) * scale;
  const ox = (w - side) / 2, oy = (h - side) / 2;
  const ss = 3;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      let white = 0, black = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const X = px + (sx + 0.5) / ss, Y = py + (sy + 0.5) / ss;
          const u = (X - ox) / side, v = (Y - oy) / side;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && lock(u, v)) white++;
          else if (bg === 'square') black++;
          else if (bg === 'circle' && Math.hypot(X / w - 0.5, Y / h - 0.5) <= 0.5) black++;
        }
      const n = ss * ss, i = (py * w + px) * 4;
      const v = white + black ? Math.round((white * 255) / (white + black)) : 0;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = Math.round(((white + black) / n) * 255);
    }
  return png(w, h, out);
}

const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, m] of Object.entries(DENSITY)) {
  const dir = path.join(RES, `mipmap-${d}`);
  writeFileSync(path.join(dir, 'ic_launcher.png'), render(48 * m, 48 * m, { scale: 0.86, bg: 'square' }));
  writeFileSync(path.join(dir, 'ic_launcher_round.png'), render(48 * m, 48 * m, { scale: 0.8, bg: 'circle' }));
  // Adaptive icon foreground: 108dp canvas, glyph inside the 66dp safe zone.
  writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), render(108 * m, 108 * m, { scale: 0.56 }));
}

// Splash screens: black with a small centred lock, same sizes as the template.
for (const name of readdirSync(RES)) {
  const f = path.join(RES, name, 'splash.png');
  if (!existsSync(f)) continue;
  const b = readFileSync(f);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  writeFileSync(f, render(w, h, { scale: 0.22, bg: 'square' }));
}
console.log('android icons written');

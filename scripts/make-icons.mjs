// Draws the extension icon (a speech bubble with a sparkle) as PNGs, with no image dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const INDIGO = [79, 70, 229];
const AMBER = [251, 191, 36];

// Shape tests in a 0..1 coordinate space, supersampled for smooth edges.
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const s = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const t = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  return (s >= 0 && t >= 0 && d >= 0) || (s <= 0 && t <= 0 && d <= 0);
}
function inSparkle(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
  return Math.sqrt(dx) + Math.sqrt(dy) <= Math.sqrt(r);
}
function color(x, y) {
  if (inSparkle(x, y, 0.5, 0.44, 0.2)) return AMBER;
  const bubble = inRoundRect(x, y, 0.1, 0.12, 0.9, 0.74, 0.16) ||
    inTriangle(x, y, [0.26, 0.7], [0.46, 0.7], [0.22, 0.92]);
  if (bubble) return INDIGO;
  return null;
}
function pixel(px, py, size) {
  const N = 4;
  let hits = 0, acc = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const c = color((px + (i + 0.5) / N) / size, (py + (j + 0.5) / N) / size);
    if (c) { hits++; acc = acc.map((v, k) => v + c[k]); }
  }
  if (!hits) return [0, 0, 0, 0];
  return [...acc.map((v) => Math.round(v / hits)), Math.round((255 * hits) / (N * N))];
}

for (const size of [16, 48, 128]) {
  writeFileSync(`public/icons/icon${size}.png`, png(size, pixel));
}
console.log("Icons written to public/icons/");

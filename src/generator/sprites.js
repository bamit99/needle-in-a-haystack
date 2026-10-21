import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { hashSeed, mulberry32 } from './rng.js';

export const RENDERER_VERSION = '1';

export function renderSprite(label, seedStr, size = 256) {
  if (label !== 'hay' && label !== 'needle') throw new Error(`unknown label ${label}`);
  const bg = mulberry32(hashSeed(`${RENDERER_VERSION}:bg:${seedStr}`));
  const rng = mulberry32(hashSeed(`${RENDERER_VERSION}:${label}:${seedStr}`));
  const png = new PNG({ width: size, height: size });
  const base = 110 + Math.floor(bg() * 30);
  const gx = bg() * size, gy = bg() * size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - gx, y - gy) / size;
    const light = 1.15 - d * 0.4 + (bg() - 0.5) * 0.06;
    const v = Math.max(0, Math.min(255, Math.round(base * light)));
    const i = (size * y + x) << 2;
    png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; png.data[i + 3] = 255;
  }
  const cx = size / 2 + (rng() - 0.5) * size * 0.2, cy = size / 2 + (rng() - 0.5) * size * 0.2;
  const rot = rng() * Math.PI * 2, scale = 0.7 + rng() * 0.3;
  if (label === 'hay') drawStraw(png, rng, cx, cy, rot, scale, size);
  else drawNeedle(png, rng, cx, cy, rot, scale, size);
  const blobs = Math.floor(rng() * 3); // partial occlusion, background tone
  for (let b = 0; b < blobs; b++) {
    const bx = cx + (rng() - 0.5) * size * 0.3 * scale, by = cy + (rng() - 0.5) * size * 0.3 * scale;
    const r = 4 + rng() * 6;
    for (let y = Math.floor(by - r); y <= by + r; y++) for (let x = Math.floor(bx - r); x <= bx + r; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size || Math.hypot(x - bx, y - by) > r) continue;
      const i = (size * y + x) << 2;
      png.data[i] = base; png.data[i + 1] = base; png.data[i + 2] = base;
    }
  }
  const pngBuf = PNG.sync.write(png);
  return { png: pngBuf, sha256: createHash('sha256').update(pngBuf).digest('hex') };
}

function px(png, size, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (size * y + x) << 2;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
}
function drawStraw(png, rng, cx, cy, rot, scale, size) {
  const len = size * 0.55 * scale, bend = (rng() - 0.5) * 0.8;
  const p0x = cx - Math.cos(rot) * len / 2, p0y = cy - Math.sin(rot) * len / 2;
  const p2x = cx + Math.cos(rot) * len / 2, p2y = cy + Math.sin(rot) * len / 2;
  const p1x = cx + (rng() - 0.5) * len * 0.4 + Math.cos(rot + Math.PI / 2) * bend * len * 0.3;
  const p1y = cy + (rng() - 0.5) * len * 0.4 + Math.sin(rot + Math.PI / 2) * bend * len * 0.3;
  for (let t = 0; t <= 1; t += 0.002) {
    const w = (3.5 - 2.5 * Math.abs(t - 0.5) * 2) * scale;
    const bx = (1 - t) * (1 - t) * p0x + 2 * (1 - t) * t * p1x + t * t * p2x;
    const by = (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * p1y + t * t * p2y;
    const shade = 0.85 + rng() * 0.3;
    const r = Math.round(196 * shade), g = Math.round(164 * shade), b = Math.round(90 * shade);
    for (let k = -Math.ceil(w); k <= Math.ceil(w); k++) px(png, size, Math.round(bx), Math.round(by + k), r, g, b);
  }
}
function drawNeedle(png, rng, cx, cy, rot, scale, size) {
  const len = size * 0.6 * scale;
  const ex = cx + Math.cos(rot) * len / 2, ey = cy + Math.sin(rot) * len / 2;
  const sx = cx - Math.cos(rot) * len / 2, sy = cy - Math.sin(rot) * len / 2;
  for (let t = 0; t <= 1; t += 0.002) {
    const shade = 150 + Math.round(rng() * 40);
    const w = (1.5 - t * 0.8) * scale;
    const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t;
    for (let k = -Math.ceil(w); k <= Math.ceil(w); k++) px(png, size, Math.round(x), Math.round(y + k), shade, shade, shade + 15);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    const x = sx + Math.cos(rot + Math.PI / 2) * 3 * scale * Math.cos(a) + Math.cos(rot) * 4 * scale * Math.sin(a);
    const y = sy + Math.sin(rot + Math.PI / 2) * 3 * scale * Math.cos(a) + Math.sin(rot) * 4 * scale * Math.sin(a);
    px(png, size, Math.round(x), Math.round(y), 90, 90, 100);
  }
}

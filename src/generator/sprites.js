import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { hashSeed, mulberry32 } from './rng.js';

export const RENDERER_VERSION = '2';

const HAY_COLOR = [225, 195, 120];   // bright straw
const NEEDLE_COLOR = [25, 32, 85];   // deep blue steel

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function shaded(color, shade) {
  return [clamp(color[0] * shade), clamp(color[1] * shade), clamp(color[2] * shade)];
}

export function renderSprite(label, seedStr, size = 256) {
  if (label !== 'hay' && label !== 'needle') throw new Error(`unknown label ${label}`);
  const bg = mulberry32(hashSeed(`${RENDERER_VERSION}:bg:${seedStr}`));
  const rng = mulberry32(hashSeed(`${RENDERER_VERSION}:${label}:${seedStr}`));
  const png = new PNG({ width: size, height: size });
  const base = 112 + Math.floor(bg() * 10);
  const gx = bg() * size, gy = bg() * size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - gx, y - gy) / size;
    const light = 1.0 - d * 0.18 + (bg() - 0.5) * 0.05;
    const v = clamp(base * light);
    const i = (size * y + x) << 2;
    png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; png.data[i + 3] = 255;
  }
  const cx = size / 2 + (rng() - 0.5) * size * 0.2, cy = size / 2 + (rng() - 0.5) * size * 0.2;
  const rot = rng() * Math.PI * 2, scale = 0.9 + rng() * 0.2;
  // background clutter first: it must never punch holes in the item
  const blobs = Math.floor(rng() * 3);
  for (let b = 0; b < blobs; b++) {
    const bx = cx + (rng() - 0.5) * size * 0.5, by = cy + (rng() - 0.5) * size * 0.5;
    const r = 4 + rng() * 7;
    for (let y = Math.floor(by - r); y <= by + r; y++) for (let x = Math.floor(bx - r); x <= bx + r; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size || Math.hypot(x - bx, y - by) > r) continue;
      const i = (size * y + x) << 2;
      const v = clamp(base * (0.9 + rng() * 0.12));
      png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v;
    }
  }
  if (label === 'hay') drawHay(png, rng, cx, cy, rot, scale, size);
  else drawNeedle(png, rng, cx, cy, rot, scale, size);
  const pngBuf = PNG.sync.write(png);
  return { png: pngBuf, sha256: createHash('sha256').update(pngBuf).digest('hex') };
}

function px(png, size, x, y, rgb) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (size * y + x) << 2;
  png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255;
}

function drawNeedle(png, rng, cx, cy, rot, scale, size) {
  const len = size * 0.7 * scale;
  const ex = cx + Math.cos(rot) * len / 2, ey = cy + Math.sin(rot) * len / 2;
  const sx = cx - Math.cos(rot) * len / 2, sy = cy - Math.sin(rot) * len / 2;
  const ux = Math.cos(rot + Math.PI / 2), uy = Math.sin(rot + Math.PI / 2);
  for (let t = 0; t <= 1; t += 0.002) {
    const shade = 0.85 + rng() * 0.3;
    const w = (3 + 8 * (1 - t)) * scale;         // thick at the eye, tapering to a point
    const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t;
    for (let k = -Math.ceil(w); k <= Math.ceil(w); k++) {
      px(png, size, Math.round(x + ux * k), Math.round(y + uy * k), shaded(NEEDLE_COLOR, shade));
    }
  }
  for (let a = 0; a < Math.PI * 2; a += 0.25) {   // the eye
    const ex2 = sx + ux * 3 * scale * Math.cos(a) + Math.cos(rot) * 3 * scale * Math.sin(a);
    const ey2 = sy + uy * 3 * scale * Math.cos(a) + Math.sin(rot) * 3 * scale * Math.sin(a);
    px(png, size, Math.round(ex2), Math.round(ey2), [150, 150, 150]);
  }
}

function drawHay(png, rng, cx, cy, rot, scale, size) {
  const len = size * 0.6 * scale;
  const spread = 6 * scale;
  const ux = Math.cos(rot + Math.PI / 2), uy = Math.sin(rot + Math.PI / 2);
  for (let s = -1; s <= 1; s++) {
    const off = s * spread;
    const p0x = cx - Math.cos(rot) * len / 2 + ux * off, p0y = cy - Math.sin(rot) * len / 2 + uy * off;
    const p2x = cx + Math.cos(rot) * len / 2 + ux * off, p2y = cy + Math.sin(rot) * len / 2 + uy * off;
    const bend = (rng() - 0.5) * 0.5;
    const p1x = (p0x + p2x) / 2 + ux * (bend * len * 0.25) + (rng() - 0.5) * 5;
    const p1y = (p0y + p2y) / 2 + uy * (bend * len * 0.25) + (rng() - 0.5) * 5;
    for (let t = 0; t <= 1; t += 0.002) {
      const shade = 0.86 + rng() * 0.26;
      const w = (3.5 + 3.5 * (1 - Math.abs(t - 0.5) * 2)) * scale;
      const bx = (1 - t) * (1 - t) * p0x + 2 * (1 - t) * t * p1x + t * t * p2x;
      const by = (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * p1y + t * t * p2y;
      for (let k = -Math.ceil(w); k <= Math.ceil(w); k++) {
        px(png, size, Math.round(bx + ux * k), Math.round(by + uy * k), shaded(HAY_COLOR, shade));
      }
    }
  }
}

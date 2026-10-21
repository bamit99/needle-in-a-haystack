import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { renderSprite, RENDERER_VERSION } from '../src/generator/sprites.js';

test('same seed and version reproduce identical bytes', () => {
  assert.equal(renderSprite('hay', 'seed-1').sha256, renderSprite('hay', 'seed-1').sha256);
  assert.equal(renderSprite('needle', 'seed-2').sha256, renderSprite('needle', 'seed-2').sha256);
});
test('hay and needle with same seed differ', () => {
  assert.notEqual(renderSprite('hay', 'seed-1').sha256, renderSprite('needle', 'seed-1').sha256);
});
test('background has no class cue: same-seed hay and needle share corner pixel', () => {
  const h = PNG.sync.read(renderSprite('hay', 's7').png);
  const n = PNG.sync.read(renderSprite('needle', 's7').png);
  assert.equal(h.data[0], n.data[0]); // top-left pixel is background only
});

// A vision model downsamples before it looks, so a 1px line is invisible.
// Average-downscale to 64x64 (what a model effectively sees) and require the
// object to survive it.
const isObjectPixel = (r, g, b) => (r > g && g > b && r - b > 20) || (b > r && b - r >= 10);

function downscaleAvg(png, factor) {
  const w = Math.floor(png.width / factor), h = Math.floor(png.height / factor);
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y * factor; yy < (y + 1) * factor; yy++) for (let xx = x * factor; xx < (x + 1) * factor; xx++) {
      const i = (png.width * yy + xx) << 2;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
    }
    out.push([r / n, g / n, b / n]);
  }
  return { w, h, pixels: out };
}

function legibility(png) {
  const d = downscaleAvg(png, 4);
  let count = 0, minX = 1e9, maxX = -1, objLum = 0, bgLum = 0, bgCount = 0;
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
    const [r, g, b] = d.pixels[y * d.w + x];
    if (isObjectPixel(r, g, b)) { count++; objLum += (r + g + b) / 3; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    else { bgLum += (r + g + b) / 3; bgCount++; }
  }
  return {
    count,
    spanX: count ? maxX - minX + 1 : 0,
    contrast: count ? Math.abs(objLum / count - bgLum / bgCount) : 0,
  };
}

for (const cls of ['hay', 'needle']) {
  test(`${cls} survives a 4x downscale and contrasts with the background`, () => {
    const png = PNG.sync.read(renderSprite(cls, 'legible-1').png);
    const l = legibility(png);
    assert.ok(l.count >= 20, `${cls}: only ${l.count} visible pixels at 64x64`);
    assert.ok(l.spanX >= 10, `${cls}: spans only ${l.spanX} columns at 64x64`);
    assert.ok(l.contrast >= 40, `${cls}: contrast ${l.contrast.toFixed(1)} is too low`);
  });
}

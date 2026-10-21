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

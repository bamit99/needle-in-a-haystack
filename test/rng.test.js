import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, mulberry32 } from '../src/generator/rng.js';

test('same string seeds same sequence', () => {
  const a = mulberry32(hashSeed('seed-1'));
  const b = mulberry32(hashSeed('seed-1'));
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});
test('different strings seed different sequences', () => {
  assert.notEqual(mulberry32(hashSeed('a'))(), mulberry32(hashSeed('b'))());
});
test('values in [0,1)', () => {
  const r = mulberry32(hashSeed('x'));
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});

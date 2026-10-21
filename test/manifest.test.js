import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from '../src/generator/manifest.js';

test('counts and shuffle are deterministic for a seed', async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'nihs-a-'));
  const dirB = await mkdtemp(join(tmpdir(), 'nihs-b-'));
  const a = await buildManifest({ hayCount: 10, needleCount: 3, seed: 's42', outDir: dirA });
  const b = await buildManifest({ hayCount: 10, needleCount: 3, seed: 's42', outDir: dirB });
  assert.equal(a.items.length, 13);
  assert.equal(a.items.filter(i => i.groundTruth === 'needle').length, 3);
  assert.deepEqual(a.items.map(i => [i.itemId, i.groundTruth, i.imageSha256]),
                   b.items.map(i => [i.itemId, i.groundTruth, i.imageSha256]));
  const onDisk = JSON.parse(await readFile(join(dirA, 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk.items, a.items);
  await rm(dirA, { recursive: true }); await rm(dirB, { recursive: true });
});

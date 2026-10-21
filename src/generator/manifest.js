import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashSeed, mulberry32 } from './rng.js';
import { renderSprite, RENDERER_VERSION } from './sprites.js';

export async function buildManifest({ hayCount, needleCount, seed, outDir, imageSize = 256 }) {
  const items = [];
  for (let i = 0; i < hayCount; i++) items.push({ groundTruth: 'hay', seed: `${seed}:i${i}` });
  for (let i = 0; i < needleCount; i++) items.push({ groundTruth: 'needle', seed: `${seed}:n${i}` });
  const rng = mulberry32(hashSeed(`${RENDERER_VERSION}:shuffle:${seed}`));
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  await mkdir(outDir, { recursive: true });
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const { png, sha256 } = renderSprite(items[i].groundTruth, items[i].seed, imageSize);
    const imagePath = `${String(i).padStart(3, '0')}-${sha256.slice(0, 8)}.png`;
    await writeFile(join(outDir, imagePath), png);
    out.push({ itemId: `item-${String(i).padStart(3, '0')}`, seed: items[i].seed, groundTruth: items[i].groundTruth, imageSha256: sha256, imagePath });
  }
  const manifest = { runId: `run-${Date.now()}`, seed, rendererVersion: RENDERER_VERSION, items: out };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

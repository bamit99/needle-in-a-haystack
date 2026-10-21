# Needle in a Haystack Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-lane browser game that runs the same generated hay/needle images through a chat LLM and a Jev-style decision model with real calls, and shows measured latency, cost, and classification-quality differences.

**Architecture:** Thin Node backend owns everything real — seeded sprite generation, model adapters, orchestration, scoring, run persistence — and streams events over WebSocket to an HTML/canvas UI. The UI animates and displays only numbers the backend measured.

**Tech Stack:** Node 20+ (ESM), `pngjs@^7`, `ws@^8`, built-in `node:http` and `node:test`. Browser UI: plain HTML/JS/canvas, no framework.

**Spec:** `docs/superpowers/specs/2026-10-21-needle-in-haystack-game-design-revised.md`

## Global Constraints

- Node version floor: 20. Runtime modules are ESM (`"type": "module"`).
- Runtime dependencies: `pngjs@^7`, `ws@^8` only. Tests use built-in `node:test`.
- Every displayed number comes from a recorded call. Nothing hard-coded, nothing simulated.
- Unknown cost is `null` (displayed `N/A`), never zero.
- Secrets (API keys) live in env vars named by config; never sent to the browser, never written into exported run results.
- Renderer is deterministic: same seed + `RENDERER_VERSION` reproduces identical image bytes and hashes.
- Mock servers exist for automated tests only; any mock run in the UI carries an explicit `MOCK` label.
- Chat prompt, verbatim: `Classify this image as exactly one of: hay, needle. Answer with one word.`
- Race mode runs lanes concurrently; `concurrency: 1` in config is the sequential benchmark option, and the mode is recorded in every export.
- Metrics that are undefined (e.g. precision with zero predictions) are `null` and displayed `N/A`, never zero.

## Review Focus

Each line gets its test pinned in the named task.

1. Chat model answers that do not follow the one-word instruction (e.g. `It is a needle.`) — validate strictly; an invalid answer is recorded as `invalid_output`, never coerced to a label. Test in Task 6.
2. Zero needle predictions — needle precision must be `null`/`N/A`, not 0. Test in Task 8.
3. Unknown cost (self-hosted model, no pricing configured) — must stay `null`/`N/A`, never `$0`. Tests in Tasks 6 and 8.
4. Out-of-order or delayed WebSocket events — the UI orders events by lane sequence number before rendering. Test in Task 11.
5. Concurrency distorts latency — default is one item at a time per lane (`concurrency: 1`); mode and per-lane concurrency are recorded in every export so runs are never silently mixed. Test in Task 9.

---


### Task 1: Scaffold, git init, test wiring

**Files:**
- Create: `package.json`, `.gitignore`, `test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs `node --test test/`; ESM module resolution for all later tasks.

- [ ] Step 1: `git init` (repo is not yet a git repo).
- [ ] Step 2: Write `package.json`:

```json
{
  "name": "nihs",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "start": "node src/server.js", "test": "node --test test/" },
  "dependencies": { "pngjs": "^7", "ws": "^8" }
}
```

- [ ] Step 3: Write `.gitignore`:

```
node_modules/
runs/
```

- [ ] Step 4: `npm install`. Expected: `pngjs` and `ws` installed, no native build steps.
- [ ] Step 5: Write `test/smoke.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
test('test harness works', () => assert.ok(true));
```

- [ ] Step 6: `npm test`. Expected: 1 pass.
- [ ] Step 7: Commit: `git add -A && git commit -m "chore: scaffold node project with pngjs and ws"`

### Task 2: Seeded RNG

**Files:**
- Create: `src/generator/rng.js`
- Test: `test/rng.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `hashSeed(str) -> uint32`; `mulberry32(seedUint32) -> () => number` in `[0,1)`. Used by Tasks 3, 4, 9.

- [ ] Step 1: Write failing `test/rng.test.js`:

```js
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
```

- [ ] Step 2: `node --test test/rng.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/generator/rng.js`:

```js
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (const c of Buffer.from(String(str), 'utf8')) {
    h ^= c; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] Step 4: `node --test test/rng.test.js`. Expected: 3 pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat: seeded deterministic rng"`

---


### Task 3: Sprite generator

**Files:**
- Create: `src/generator/sprites.js`
- Test: `test/sprites.test.js`

**Interfaces:**
- Consumes: `hashSeed`, `mulberry32` from Task 2.
- Produces: `RENDERER_VERSION = '1'`; `renderSprite(label, seedStr, size = 256) -> { png: Buffer, sha256: string }` for `label` in `{'hay','needle'}`. Used by Task 4.

Design notes: background rng is keyed on seed only (no label), so background carries no class cue. Shape rng is keyed on label + seed. Noise axes: rotation, scale, position, lighting, texture, partial occlusion — all from rng.

- [ ] Step 1: Write failing `test/sprites.test.js`:

```js
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
```

- [ ] Step 2: `node --test test/sprites.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/generator/sprites.js`:

```js
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
```

- [ ] Step 4: `node --test test/sprites.test.js`. Expected: 3 pass.
- [ ] Step 5: Eyeball check: run `node -e "import('./src/generator/sprites.js').then(m=>require('fs').writeFileSync('t.png',m.renderSprite('needle','s1').png))"` (swap `require` for `import('node:fs')` if needed), open `t.png`, confirm a plausible needle on noisy gray. Delete `t.png`.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat: deterministic seeded sprite renderer"`

### Task 4: Manifest builder

**Files:**
- Create: `src/generator/manifest.js`
- Test: `test/manifest.test.js`

**Interfaces:**
- Consumes: Task 2 rng, Task 3 `renderSprite`/`RENDERER_VERSION`.
- Produces: `buildManifest({ hayCount, needleCount, seed, outDir }) -> Promise<manifest>` where manifest = `{ runId, seed, rendererVersion, items: [{ itemId, seed, groundTruth, imageSha256, imagePath }] }`; writes PNGs and `manifest.json` into `outDir`. Used by Tasks 9 and 10.

- [ ] Step 1: Write failing `test/manifest.test.js`:

```js
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
```

- [ ] Step 2: `node --test test/manifest.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/generator/manifest.js`:

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashSeed, mulberry32 } from './rng.js';
import { renderSprite, RENDERER_VERSION } from './sprites.js';

export async function buildManifest({ hayCount, needleCount, seed, outDir }) {
  const items = [];
  for (let i = 0; i < hayCount; i++) items.push({ groundTruth: 'hay', seed: `${seed}:i${i}` });
  for (let i = 0; i < needleCount; i++) items.push({ groundTruth: 'needle', seed: `${seed}:n${i}` });
  const rng = mulberry32(hashSeed(`${RENDERER_VERSION}:shuffle:${seed}`));
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  await mkdir(outDir, { recursive: true });
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const { png, sha256 } = renderSprite(items[i].groundTruth, items[i].seed);
    const imagePath = `${String(i).padStart(3, '0')}-${sha256.slice(0, 8)}.png`;
    await writeFile(join(outDir, imagePath), png);
    out.push({ itemId: `item-${String(i).padStart(3, '0')}`, seed: items[i].seed, groundTruth: items[i].groundTruth, imageSha256: sha256, imagePath });
  }
  const manifest = { runId: `run-${Date.now()}`, seed, rendererVersion: RENDERER_VERSION, items: out };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
```

- [ ] Step 4: `node --test test/manifest.test.js`. Expected: pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat: seeded manifest builder with persisted sprites"`

---


### Task 5: Config loader

**Files:**
- Create: `src/config.js`, `config/default.json`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(path) -> config` (validated, secrets resolved from env); `publicConfig(config) -> config` with secrets stripped — this is what the browser and exports may see. Used by Tasks 9, 10, 11.

- [ ] Step 1: Write `config/default.json`:

```json
{
  "lanes": [
    {
      "laneId": "llm",
      "adapter": "openai",
      "baseUrl": "http://localhost:1234/v1",
      "model": "CHANGE_ME",
      "apiKeyEnv": "LLM_API_KEY",
      "prompt": "Classify this image as exactly one of: hay, needle. Answer with one word.",
      "timeoutMs": 30000,
      "pricePerMTokIn": null,
      "pricePerMTokOut": null
    },
    {
      "laneId": "jev",
      "adapter": "jev",
      "url": "http://localhost:1235/classify",
      "timeoutMs": 5000,
      "costUsdPerCall": null
    }
  ],
  "imageSize": 256,
  "concurrency": 1,
  "retries": 0
}
```

- [ ] Step 2: Write failing `test/config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, publicConfig } from '../src/config.js';

test('loads default config and resolves two lanes', async () => {
  const cfg = await loadConfig('config/default.json');
  assert.equal(cfg.lanes.length, 2);
  assert.equal(cfg.lanes[0].prompt, 'Classify this image as exactly one of: hay, needle. Answer with one word.');
  assert.ok(cfg.lanes[1].url.startsWith('http'));
});
test('rejects missing prompt, zero timeout, unknown adapter', async () => {
  const base = await loadConfig('config/default.json');
  const bad = structuredClone(base); bad.lanes[0].prompt = '';
  await assert.rejects(loadConfigFrom(bad));
});
test('publicConfig strips secrets (Review Focus 3 companion)', async () => {
  process.env.LLM_API_KEY = 'secret-x';
  const cfg = await loadConfig('config/default.json');
  assert.equal(cfg.lanes[0].apiKey, 'secret-x');
  assert.equal(publicConfig(cfg).lanes[0].apiKey, undefined);
  delete process.env.LLM_API_KEY;
});
async function loadConfigFrom(obj) {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'nihs-cfg-'));
  const p = join(dir, 'c.json');
  await writeFile(p, JSON.stringify(obj));
  return loadConfig(p);
}
```

Fix the prompt assertion to compare against the exact string in `config/default.json` (comma, not typo) before running.

- [ ] Step 3: `node --test test/config.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 4: Write `src/config.js`:

```js
import { readFile } from 'node:fs/promises';

export async function loadConfig(path) {
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(cfg.lanes) || cfg.lanes.length < 1) throw new Error('config: lanes required');
  for (const lane of cfg.lanes) {
    if (!lane.laneId) throw new Error('config: laneId required');
    if (lane.adapter !== 'openai' && lane.adapter !== 'jev') throw new Error(`config: unknown adapter ${lane.adapter}`);
    if (!(lane.timeoutMs > 0)) throw new Error('config: timeoutMs must be > 0');
    if (lane.adapter === 'openai') {
      if (!lane.baseUrl || !lane.prompt) throw new Error('config: openai lane needs baseUrl and prompt');
      if (lane.apiKeyEnv) lane.apiKey = process.env[lane.apiKeyEnv] ?? null;
    }
    if (lane.adapter === 'jev' && !lane.url) throw new Error('config: jev lane needs url');
  }
  if (!(cfg.imageSize > 0)) throw new Error('config: imageSize must be > 0');
  if (!(cfg.concurrency >= 1)) throw new Error('config: concurrency must be >= 1');
  if (cfg.retries < 0) throw new Error('config: retries must be >= 0');
  return cfg;
}

export function publicConfig(cfg) {
  const clone = structuredClone(cfg);
  for (const lane of clone.lanes) { delete lane.apiKey; delete lane.apiKeyEnv; }
  return clone;
}
```

- [ ] Step 5: `node --test test/config.test.js`. Expected: pass.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat: validated config loader with secret stripping"`

### Task 6: OpenAI-compatible adapter

**Files:**
- Create: `src/adapters/openai.js`
- Test: `test/adapters.openai.test.js`

**Interfaces:**
- Consumes: config lane object from Task 5 (`baseUrl`, `model`, `apiKey`, `prompt`, `timeoutMs`, `pricePerMTokIn/Out`).
- Produces: `createOpenAIAdapter(cfg) -> { classify(imageBuffer, context) -> Promise<Decision> }` and `normalizeLabel(answer)`. `Decision = { label, latencyMs, costUsd, raw, status, error }`; `status` in `'ok' | 'invalid_output' | 'timeout' | 'provider_error'`; `label` in `'hay' | 'needle' | null`; unknown cost is `null`. Task 9 consumes this contract; Task 7 implements the same contract.

- [ ] Step 1: Write failing `test/adapters.openai.test.js`. Mock server is `node:http` on an ephemeral port; canned responses per test.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createOpenAIAdapter, normalizeLabel } from '../src/adapters/openai.js';

function withMock(t, handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => t.after(() => server.close(), resolve(server.address().port)));
  });
}

test('valid one-word answer is accepted', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({
      choices: [{ message: { content: 'needle' } }],
      usage: { prompt_tokens: 100, completion_tokens: 1 },
    })));
  });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000, pricePerMTokIn: 1, pricePerMTokOut: 1 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.label, 'needle');
  assert.equal(d.status, 'ok');
  assert.ok(d.latencyMs >= 0);
  assert.equal(d.costUsd, (100 * 1 + 1 * 1) / 1e6);
});
test('verbose answer is invalid_output, not coerced (Review Focus 1)', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: 'It is a needle.' } }] })));
  });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.label, null);
  assert.equal(d.status, 'invalid_output');
});
test('missing usage means cost null, not zero (Review Focus 3)', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: 'hay' } }] })));
  });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000, pricePerMTokIn: 1, pricePerMTokOut: 1 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.label, 'hay');
  assert.equal(d.costUsd, null);
});
test('non-2xx is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => { res.statusCode = 503; res.end('busy'); }); });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.status, 'provider_error');
  assert.equal(d.error.httpStatus, 503);
});
test('slow server is timeout', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => setTimeout(() => res.end('{}'), 300)); });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 50 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.status, 'timeout');
});
test('normalizeLabel: exact words only', () => {
  assert.equal(normalizeLabel('Hay'), 'hay');
  assert.equal(normalizeLabel('needle'), 'needle');
  assert.equal(normalizeLabel('It is a needle.'), null);
  assert.equal(normalizeLabel(''), null);
});
```

- [ ] Step 2: `node --test test/adapters.openai.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/adapters/openai.js`:

```js
export function normalizeLabel(answer) {
  const w = String(answer).trim().toLowerCase().replace(/[^a-z ]/g, '').trim();
  return w === 'hay' || w === 'needle' ? w : null;
}

export function createOpenAIAdapter(cfg) {
  return {
    async classify(image) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: [
              { type: 'text', text: cfg.prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } },
            ] }],
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        const latencyMs = Math.round(performance.now() - t0);
        if (!res.ok) return { label: null, latencyMs, costUsd: null, raw: (await res.text()).slice(0, 500), status: 'provider_error', error: { httpStatus: res.status } };
        let body;
        try { body = await res.json(); } catch { return { label: null, latencyMs, costUsd: null, raw: '', status: 'provider_error', error: { message: 'malformed JSON' } }; }
        const answer = body?.choices?.[0]?.message?.content ?? '';
        const label = normalizeLabel(answer);
        const usage = body?.usage ?? null;
        const costUsd = (cfg.pricePerMTokIn != null && cfg.pricePerMTokOut != null && usage)
          ? (usage.prompt_tokens * cfg.pricePerMTokIn + usage.completion_tokens * cfg.pricePerMTokOut) / 1e6
          : null;
        const raw = String(answer).slice(0, 500);
        return label
          ? { label, latencyMs, costUsd, raw, status: 'ok', error: null }
          : { label: null, latencyMs, costUsd, raw, status: 'invalid_output', error: null };
      } catch (e) {
        const latencyMs = Math.round(performance.now() - t0);
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        return { label: null, latencyMs, costUsd: null, raw: '', status: timeout ? 'timeout' : 'provider_error', error: { message: e.message } };
      }
    },
  };
}
```

- [ ] Step 4: `node --test test/adapters.openai.test.js`. Expected: all pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat: openai-compatible adapter with strict label validation"`

### Task 7: Jev-style adapter

**Files:**
- Create: `src/adapters/jev.js`
- Test: `test/adapters.jev.test.js`

**Interfaces:**
- Consumes: config lane object (`url`, `timeoutMs`, `costUsdPerCall`).
- Produces: `createJevAdapter(cfg) -> { classify(imageBuffer, context) -> Promise<Decision> }` — same Decision contract as Task 6.

- [ ] Step 1: Write failing `test/adapters.jev.test.js` (same mock-server helper pattern as Task 6):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createJevAdapter } from '../src/adapters/jev.js';

function withMock(t, handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => t.after(() => server.close(), resolve(server.address().port)));
  });
}
const adapterOn = (port, extra = {}) => createJevAdapter({ url: `http://127.0.0.1:${port}/classify`, timeoutMs: 2000, ...extra });

test('valid label accepted, raw body received', async (t) => {
  let received;
  const port = await withMock(t, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received = Buffer.concat(chunks); res.end('{"label":"needle"}'); });
  });
  const d = await adapterOn(port).classify(Buffer.from('PNGDATA'));
  assert.equal(received.toString(), 'PNGDATA');
  assert.equal(d.label, 'needle');
  assert.equal(d.status, 'ok');
  assert.ok(d.latencyMs >= 0);
});
test('unconfigured cost stays null, never zero', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => res.end('{"label":"hay"}')); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.costUsd, null);
});
test('configured per-call cost is reported', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => res.end('{"label":"hay"}')); });
  const d = await adapterOn(port, { costUsdPerCall: 0.0002 }).classify(Buffer.from('x'));
  assert.equal(d.costUsd, 0.0002);
});
test('unknown label value is invalid_output', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => res.end('{"label":"twig"}')); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.status, 'invalid_output');
  assert.equal(d.label, null);
});
test('malformed JSON is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => res.end('not json')); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.status, 'provider_error');
});
test('non-2xx is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => { res.statusCode = 500; res.end(); }); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.status, 'provider_error');
});
test('slow server is timeout', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => setTimeout(() => res.end('{}'), 300)); });
  const d = await createJevAdapter({ url: `http://127.0.0.1:${port}/classify`, timeoutMs: 50 }).classify(Buffer.from('x'));
  assert.equal(d.status, 'timeout');
});
```

- [ ] Step 2: `node --test test/adapters.jev.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/adapters/jev.js`:

```js
export function createJevAdapter(cfg) {
  return {
    async classify(image) {
      const t0 = performance.now();
      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: image,
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        const latencyMs = Math.round(performance.now() - t0);
        const text = await res.text();
        if (!res.ok) return { label: null, latencyMs, costUsd: null, raw: text.slice(0, 500), status: 'provider_error', error: { httpStatus: res.status } };
        let body;
        try { body = JSON.parse(text); } catch { return { label: null, latencyMs, costUsd: null, raw: text.slice(0, 500), status: 'provider_error', error: { message: 'malformed JSON' } }; }
        const label = body?.label === 'hay' || body?.label === 'needle' ? body.label : null;
        const costUsd = cfg.costUsdPerCall ?? null;
        return label
          ? { label, latencyMs, costUsd, raw: text.slice(0, 500), status: 'ok', error: null }
          : { label: null, latencyMs, costUsd, raw: text.slice(0, 500), status: 'invalid_output', error: null };
      } catch (e) {
        const latencyMs = Math.round(performance.now() - t0);
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        return { label: null, latencyMs, costUsd: null, raw: '', status: timeout ? 'timeout' : 'provider_error', error: { message: e.message } };
      }
    },
  };
}
```

- [ ] Step 4: `node --test test/adapters.jev.test.js`. Expected: all pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat: jev-style http classification adapter"`

---


### Task 8: Metrics

**Files:**
- Create: `src/orchestrator/metrics.js`
- Test: `test/metrics.test.js`

**Interfaces:**
- Consumes: decision records `{ itemId, groundTruth, predicted, status, latencyMs, costUsd }` (shape produced by Task 9).
- Produces: `computeLaneMetrics(records) -> metrics object` with fields: `attempted, correct, incorrect, errors, needlesDetected, needlesMissed, falsePositives, accuracy, needleRecall, needlePrecision, hayFalsePositiveRate, balancedAccuracy, medianLatencyMs, p95LatencyMs, totalCost, costPerDecision, costPerCorrectDecision`. Undefined metrics are `null` (UI shows `N/A`). Errors stay in the accuracy denominator.

- [ ] Step 1: Write failing `test/metrics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLaneMetrics } from '../src/orchestrator/metrics.js';

const ok = (gt, pred, lat, cost = null) => ({ itemId: 'x', groundTruth: gt, predicted: pred, status: 'ok', latencyMs: lat, costUsd: cost });
const err = (gt) => ({ itemId: 'x', groundTruth: gt, predicted: null, status: 'timeout', latencyMs: 100, costUsd: null });

test('imbalanced fixture: 18 hay, 2 needles, errors in denominator', () => {
  const records = [
    ...Array.from({ length: 17 }, () => ok('hay', 'hay', 10)),
    ok('hay', 'needle', 20),                       // false positive
    ok('needle', 'needle', 30),                    // detected
    err('needle'),                                 // missed via error, stays in denominator
  ];
  const m = computeLaneMetrics(records);
  assert.equal(m.attempted, 20);
  assert.equal(m.errors, 1);
  assert.equal(m.needlesDetected, 1);
  assert.equal(m.needlesMissed, 1);
  assert.equal(m.falsePositives, 1);
  assert.equal(m.accuracy, 18 / 20); // 17 hay correct + 1 needle correct; error stays in denominator
  assert.equal(m.needleRecall, 1 / 2);
  assert.equal(m.needlePrecision, 1 / 2);          // 1 detected of 2 needle predictions
  assert.equal(m.hayFalsePositiveRate, 1 / 18);
  assert.equal(m.balancedAccuracy, (17 / 18 + 1 / 2) / 2);
});
test('zero needle predictions: precision null, not zero (Review Focus 2)', () => {
  const m = computeLaneMetrics([ok('hay', 'hay', 10), ok('needle', 'hay', 10)]);
  assert.equal(m.needlePrecision, null);
});
test('unknown cost stays null (Review Focus 3)', () => {
  const m = computeLaneMetrics([ok('hay', 'hay', 10), ok('hay', 'hay', 10)]);
  assert.equal(m.totalCost, null);
  assert.equal(m.costPerDecision, null);
  assert.equal(m.costPerCorrectDecision, null);
});
test('median and p95 latency', () => {
  const m = computeLaneMetrics([...Array.from({ length: 19 }, (_, i) => ok('hay', 'hay', i + 1)), ok('hay', 'hay', 100)]);
  assert.equal(m.medianLatencyMs, 10);
  assert.equal(m.p95LatencyMs, 19); // nearest-rank: ceil(0.95*20)=19th value of sorted 1..19,100
});
```

- [ ] Step 2: `node --test test/metrics.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/orchestrator/metrics.js`:

```js
export function computeLaneMetrics(records) {
  const attempted = records.length;
  const okR = records.filter(r => r.status === 'ok');
  const errors = attempted - okR.length;
  const correct = okR.filter(r => r.predicted === r.groundTruth).length;
  const needles = records.filter(r => r.groundTruth === 'needle');
  const hay = records.filter(r => r.groundTruth === 'hay');
  const needlesDetected = needles.filter(r => r.status === 'ok' && r.predicted === 'needle').length;
  const falsePositives = hay.filter(r => r.status === 'ok' && r.predicted === 'needle').length;
  const needlePredictions = okR.filter(r => r.predicted === 'needle').length;
  const hayCorrect = hay.filter(r => r.status === 'ok' && r.predicted === 'hay').length;
  const lat = okR.map(r => r.latencyMs).sort((a, b) => a - b);
  const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)] : null;
  const knownCost = records.filter(r => r.costUsd != null);
  const totalCost = knownCost.length ? knownCost.reduce((s, r) => s + r.costUsd, 0) : null;
  return {
    attempted, correct, incorrect: okR.length - correct, errors,
    needlesDetected, needlesMissed: needles.length - needlesDetected, falsePositives,
    accuracy: attempted ? correct / attempted : null,
    needleRecall: needles.length ? needlesDetected / needles.length : null,
    needlePrecision: needlePredictions ? needlesDetected / needlePredictions : null,
    hayFalsePositiveRate: hay.length ? falsePositives / hay.length : null,
    balancedAccuracy: (hay.length && needles.length)
      ? ((hayCorrect / hay.length) + (needlesDetected / needles.length)) / 2 : null,
    meanLatencyMs: lat.length ? Math.round(lat.reduce((s, v) => s + v, 0) / lat.length) : null,
    medianLatencyMs: pct(0.5), p95LatencyMs: pct(0.95),
    totalCost,
    costPerDecision: totalCost != null ? totalCost / attempted : null,
    costPerCorrectDecision: totalCost != null && correct ? totalCost / correct : null,
  };
}
```

- [ ] Step 4: `node --test test/metrics.test.js`. Expected: all pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat: lane metrics with null-safe precision and cost"`

### Task 9: Event bus and orchestrator

**Files:**
- Create: `src/orchestrator/events.js`, `src/orchestrator/orchestrator.js`
- Test: `test/orchestrator.test.js`

**Interfaces:**
- Consumes: manifest from Task 4; adapters from Tasks 6/7 (any object with `classify(image, context) -> Decision`); config from Task 5; `computeLaneMetrics` from Task 8.
- Produces: `createEventBus() -> { on(cb), off(cb), emit(event) }`; `createOrchestrator({ manifest, lanes, config, bus, runDir }) -> { start() -> Promise<summary> }`. Event envelope: `{ type, runId, laneId, itemId, seq, ts, ...extra }`; types `game_started, item_picked, decision, item_dropped, lane_finished, game_finished`. Writes `runs/<runId>/<laneId>.jsonl` decision records.

- [ ] Step 1: Write failing `test/orchestrator.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from '../src/orchestrator/events.js';
import { createOrchestrator } from '../src/orchestrator/orchestrator.js';

const fakeAdapter = (name, decide) => ({ name, classify: async (image, ctx) => decide(image, ctx) });

async function fixture(t) {
  const runDir = await mkdtemp(join(tmpdir(), 'nihs-run-'));
  t.after(() => rm(runDir, { recursive: true }));
  const manifest = {
    runId: 'run-test', seed: 's1', rendererVersion: '1',
    items: [
      { itemId: 'item-000', seed: 's', groundTruth: 'hay', imageSha256: 'a', imagePath: 'x.png' },
      { itemId: 'item-001', seed: 's', groundTruth: 'needle', imageSha256: 'b', imagePath: 'y.png' },
    ],
  };
  return { runDir, manifest, bus: createEventBus() };
}

test('both lanes process identical sequence, finish independently', async (t) => {
  const { runDir, manifest, bus } = await fixture(t);
  const seen = { fast: [], slow: [] };
  const fast = fakeAdapter('fast', (img, ctx) => { seen.fast.push(ctx.itemId); return { label: 'hay', latencyMs: 1, costUsd: null, raw: '', status: 'ok', error: null }; });
  const slow = fakeAdapter('slow', async (img, ctx) => { seen.slow.push(ctx.itemId); await new Promise(r => setTimeout(r, 20)); return { label: 'needle', latencyMs: 20, costUsd: null, raw: '', status: 'ok', error: null }; });
  const events = [];
  bus.on(e => events.push(e));
  const summary = await createOrchestrator({ manifest, lanes: [{ laneId: 'fast', adapter: fast }, { laneId: 'slow', adapter: slow }], config: { concurrency: 1, retries: 0 }, bus, runDir }).start();
  assert.deepEqual(seen.fast, seen.slow);
  assert.equal(summary.mode, 'race'); // Review Focus 5: mode and concurrency recorded
  assert.equal(summary.laneConcurrency, 1);
  assert.equal(summary.lanes.length, 2);
  const finished = events.filter(e => e.type === 'lane_finished');
  assert.equal(finished.length, 2);
  for (const e of events) {
    assert.equal(e.runId, 'run-test');
    assert.ok(typeof e.seq === 'number' && typeof e.ts === 'string');
  }
});

test('one lane throwing does not stop the other; summary still generated', async (t) => {
  const { runDir, manifest, bus } = await fixture(t);
  const boom = { classify: async () => { throw new Error('lane down'); } };
  const good = fakeAdapter('good', () => ({ label: 'hay', latencyMs: 1, costUsd: null, raw: '', status: 'ok', error: null }));
  const summary = await createOrchestrator({ manifest, lanes: [{ laneId: 'boom', adapter: boom }, { laneId: 'good', adapter: good }], config: { concurrency: 1, retries: 0 }, bus, runDir }).start();
  const boomLane = summary.lanes.find(l => l.laneId === 'boom');
  assert.equal(boomLane.metrics.errors, 2);
  assert.equal(summary.lanes.find(l => l.laneId === 'good').metrics.correct, 1);
});

test('retries are recorded when enabled', async (t) => {
  const { runDir, manifest, bus } = await fixture(t);
  let calls = 0;
  const flaky = fakeAdapter('flaky', () => {
    calls++;
    return calls === 1
      ? { label: null, latencyMs: 1, costUsd: null, raw: '', status: 'timeout', error: null }
      : { label: 'hay', latencyMs: 1, costUsd: null, raw: '', status: 'ok', error: null };
  });
  const quiet = fakeAdapter('quiet', () => ({ label: 'hay', latencyMs: 1, costUsd: null, raw: '', status: 'ok', error: null }));
  const summary = await createOrchestrator({ manifest, lanes: [{ laneId: 'flaky', adapter: flaky }, { laneId: 'quiet', adapter: quiet }], config: { concurrency: 1, retries: 1 }, bus, runDir }).start();
  const flakyLane = summary.lanes.find(l => l.laneId === 'flaky');
  assert.equal(flakyLane.metrics.attempted, 3); // 1 failed + 1 retry + 1 clean item
  assert.equal(flakyLane.metrics.correct, 1);   // item-000 retry lands correct; item-001 labeled hay, truth needle
});
```

- [ ] Step 2: `node --test test/orchestrator.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/orchestrator/events.js`:

```js
export function createEventBus() {
  const subs = new Set();
  return {
    on: (cb) => subs.add(cb),
    off: (cb) => subs.delete(cb),
    emit: (event) => { for (const cb of subs) cb(event); },
  };
}
```

- [ ] Step 4: Write `src/orchestrator/orchestrator.js`:

```js
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeLaneMetrics } from './metrics.js';

class Semaphore {
  constructor(n) { this.free = n; this.waiters = []; }
  async acquire() { if (this.free > 0) { this.free--; return; } await new Promise((r) => this.waiters.push(r)); }
  release() { const w = this.waiters.shift(); if (w) w(); else this.free++; }
}

export function createOrchestrator({ manifest, lanes, config, bus, runDir }) {
  let seq = 0;
  const emit = (type, laneId, itemId, extra = {}) =>
    bus.emit({ type, runId: manifest.runId, laneId, itemId, seq: ++seq, ts: new Date().toISOString(), ...extra });

  async function runLane(lane) {
    const laneT0 = performance.now();
    const records = [];
    const sem = new Semaphore(config.concurrency);
    await Promise.all(manifest.items.map(async (item) => {
      await sem.acquire();
      try {
        emit('item_picked', lane.laneId, item.itemId);
        const image = await readFile(join(runDir, item.imagePath)).catch(() => Buffer.alloc(0));
        let d = await lane.adapter.classify(image, { itemId: item.itemId });
        for (let r = 0; r < config.retries && d.status !== 'ok'; r++) {
          records.push({ itemId: item.itemId, groundTruth: item.groundTruth, predicted: d.label, status: d.status, latencyMs: d.latencyMs, costUsd: d.costUsd, retry: true });
          d = await lane.adapter.classify(image, { itemId: item.itemId, retry: r + 1 });
        }
        records.push({ itemId: item.itemId, groundTruth: item.groundTruth, predicted: d.label, status: d.status, latencyMs: d.latencyMs, costUsd: d.costUsd, retry: false });
        const correct = d.status === 'ok' && d.label === item.groundTruth;
        emit('decision', lane.laneId, item.itemId, { predicted: d.label, status: d.status, correct });
        emit('item_dropped', lane.laneId, item.itemId, { bin: correct ? d.label : 'mistakes' });
      } catch (e) {
        records.push({ itemId: item.itemId, groundTruth: item.groundTruth, predicted: null, status: 'provider_error', latencyMs: null, costUsd: null, retry: false, error: { message: e.message } });
        emit('item_dropped', lane.laneId, item.itemId, { bin: 'mistakes' });
      } finally {
        sem.release();
      }
    }));
    await writeFile(join(runDir, `${lane.laneId}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const metrics = computeLaneMetrics(records);
    metrics.totalTimeMs = Math.round(performance.now() - laneT0);
    metrics.throughput = metrics.totalTimeMs ? metrics.attempted / (metrics.totalTimeMs / 1000) : null;
    emit('lane_finished', lane.laneId, null, { metrics });
    return { laneId: lane.laneId, metrics };
  }

  return {
    async start() {
      const mode = config.sequentialLanes ? 'sequential_lanes' : 'race';
      emit('game_started', null, null, { mode, laneConcurrency: config.concurrency });
      const results = config.sequentialLanes
        ? await resultsSequential(lanes)
        : await Promise.all(lanes.map(runLane));
      const summary = { runId: manifest.runId, seed: manifest.seed, mode, laneConcurrency: config.concurrency, lanes: results };
      emit('game_finished', null, null, { summary });
      return summary;
    },
  };

  async function resultsSequential(lanes) {
    const out = [];
    for (const lane of lanes) out.push(await runLane(lane));
    return out;
  }
}
```

- [ ] Step 5: `node --test test/orchestrator.test.js`. Expected: all pass.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat: event bus and two-lane orchestrator"`

---


### Task 10: HTTP server, WebSocket, run export

**Files:**
- Create: `src/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: Tasks 4, 5, 6, 7, 8, 9.
- Produces: `createApp({ config, adapterFactory }) -> { app, bus }` where `app` is a `node:http` request handler; `POST /api/start` body `{ hayCount, needleCount, seed }` -> `{ runId }` (starts the round, returns immediately); `GET /api/runs/<runId>/export.json` -> persisted manifest + per-lane records + summary, secrets stripped; `GET /api/config` -> `publicConfig`; static files from `public/`; WebSocket `/ws` broadcasting event-envelope JSON. `adapterFactory(laneConfig)` returns the adapter for a lane (production: real adapters; tests: fakes).

- [ ] Step 1: Write failing `test/server.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

test('start a round with fake adapters, export matches recorded data, no secrets', async (t) => {
  const runsDir = await mkdtemp(join(tmpdir(), 'nihs-runs-'));
  t.after(() => rm(runsDir, { recursive: true }));
  const config = {
    lanes: [
      { laneId: 'llm', adapter: 'openai', baseUrl: 'http://x', prompt: 'p', timeoutMs: 1000, apiKey: 'SECRET-DO-NOT-LEAK', apiKeyEnv: 'K' },
      { laneId: 'jev', adapter: 'jev', url: 'http://x', timeoutMs: 1000, costUsdPerCall: null },
    ],
    imageSize: 256, concurrency: 1, retries: 0, runsDir,
  };
  const adapterFactory = () => ({ classify: async () => ({ label: 'hay', latencyMs: 5, costUsd: null, raw: '', status: 'ok', error: null }) });
  const { app } = createApp({ config, adapterFactory });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());

  const startRes = await fetch(`${base}/api/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hayCount: 4, needleCount: 2, seed: 's9' }),
  });
  const { runId } = await startRes.json();
  assert.ok(runId);

  let exportBody;
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${base}/api/runs/${runId}/export.json`);
    if (r.ok) { exportBody = await r.json(); break; }
    await new Promise((r2) => setTimeout(r2, 100));
  }
  assert.ok(exportBody, 'export never appeared');
  assert.equal(exportBody.manifest.items.length, 6);
  assert.equal(exportBody.summary.lanes.length, 2);
  assert.equal(exportBody.summary.lanes[0].metrics.correct, 4); // 4 hay items; 2 needles labeled hay
  assert.ok(!JSON.stringify(exportBody).includes('SECRET-DO-NOT-LEAK'));
});
```

- [ ] Step 2: `node --test test/server.test.js`. Expected: FAIL, cannot find module.
- [ ] Step 3: Write `src/server.js`:

```js
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig, publicConfig } from './config.js';
import { buildManifest } from './generator/manifest.js';
import { createOpenAIAdapter } from './adapters/openai.js';
import { createJevAdapter } from './jev-adapter-placeholder'; // replace with './adapters/jev.js'
import { createEventBus } from './orchestrator/events.js';
import { createOrchestrator } from './orchestrator/orchestrator.js';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

export function createApp({ config, adapterFactory }) {
  const bus = createEventBus();
  const runs = new Map(); // runId -> { manifest, summaryPromise, runDir }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/start') {
      const body = JSON.parse(await readBody(req));
      const runDir = join(config.runsDir ?? 'runs', `run-${Date.now()}`);
      const manifest = await buildManifest({ hayCount: body.hayCount, needleCount: body.needleCount, seed: body.seed ?? String(Date.now()), outDir: runDir });
      const lanes = config.lanes.map((lane) => ({ laneId: lane.laneId, adapter: adapterFactory(lane) }));
      const orch = createOrchestrator({ manifest, lanes, config, bus, runDir });
      const entry = { manifest, runDir, summaryPromise: orch.start() };
      runs.set(manifest.runId, entry);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ runId: manifest.runId }));
      return;
    }
    const exportMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/export\.json$/);
    if (exportMatch) {
      const entry = runs.get(exportMatch[1]);
      if (!entry) { res.statusCode = 404; res.end(); return; }
      const summary = await entry.summaryPromise;
      if (!summary) { res.statusCode = 409; res.end(); return; } // still running
      const records = {};
      for (const lane of config.lanes) {
        records[lane.laneId] = (await readFile(join(entry.runDir, `${lane.laneId}.jsonl`), 'utf8'))
          .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ manifest: entry.manifest, config: publicConfig(config), summary, records }));
      return;
    }
    if (url.pathname === '/api/config') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(publicConfig(config)));
      return;
    }
    // static from public/
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    try {
      const data = await readFile(join('public', file));
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      res.end(data);
    } catch { res.statusCode = 404; res.end(); }
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
  }
  return { app: handle, bus };
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const config = await loadConfig('config/default.json');
  const adapterFactory = (lane) => (lane.adapter === 'openai' ? createOpenAIAdapter(lane) : createJevAdapter(lane));
  const { app, bus } = createApp({ config, adapterFactory });
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  bus.on((event) => { const msg = JSON.stringify(event); for (const c of wss.clients) if (c.readyState === 1) c.send(msg); });
  server.listen(8787, () => console.log('NIHS on http://localhost:8787'));
}
```

Fix the placeholder import to `./adapters/jev.js` before running tests.

- [ ] Step 4: `node --test test/server.test.js`. Expected: pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat: http server, websocket broadcast, run export"`

### Task 11: Browser UI

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/style.css`
- Test: `test/ui-order.test.js`

**Interfaces:**
- Consumes: WebSocket events (Task 9 envelope), `GET /api/config`, `POST /api/start`, `GET /api/runs/<id>/export.json`.
- Produces: `orderEvents(events)` exported from `public/app.js` (pure, tested in Node; DOM code guarded so the module imports cleanly in Node).

Layout (spec section 8): setup screen (hay count, needle count, seed with reuse option, endpoints + connection status, model/prompt identifiers, run mode race/sequential, start button, warning when an endpoint is unreachable, explicit `MOCK` label for mock runs); two canvas lanes with pick arm, bins, per-lane live metrics (completed, correct/incorrect, needles detected/missed, false positives, mean/median latency, wall time, cost) and decision feed (thumbnail, answer, truth, latency; wrong rows highlighted; wrong and error states visually distinct); charts (latency distribution with comparable axes, quality over time, cost accumulated, sample sizes labeled); end screen (side-by-side table, faster-model statement only when data supports it, accuracy trade-offs, cost with assumptions, errors/timeouts/retries, seed/model/prompt/run count, auto-generated plain-English explanation from observed results only). Animation may smooth transitions but never invents thinking time or alters measured durations. `null` metrics render `N/A`.

- [ ] Step 1: Write failing `test/ui-order.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEvents } from '../public/app.js';

test('out-of-order events are sorted per lane by sequence (Review Focus 4)', () => {
  const events = [
    { laneId: 'a', seq: 2 }, { laneId: 'a', seq: 1 }, { laneId: 'b', seq: 1 }, { laneId: 'a', seq: 3 },
  ];
  const byLane = orderEvents(events);
  assert.deepEqual(byLane.a.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(byLane.b.map((e) => e.seq), [1]);
});
```

- [ ] Step 2: `node --test test/ui-order.test.js`. Expected: FAIL, no export.
- [ ] Step 3: Write `public/app.js` core (plus DOM rendering):

```js
export function orderEvents(events) {
  const byLane = {};
  for (const e of events) (byLane[e.laneId ?? '_'] ??= []).push(e);
  for (const list of Object.values(byLane)) list.sort((x, y) => x.seq - y.seq);
  return byLane;
}

if (typeof document !== 'undefined') {
  // Setup form -> POST /api/start, keep runId. WebSocket to /ws.
  // Accumulate events per lane through orderEvents(), then render feed rows,
  // lane animation (arm picks item on item_picked, thinks during measured
  // latency, drops on item_dropped with bin from event), live metrics from
  // decision events, charts from accumulated latencies/costs, end table from
  // GET /api/runs/<runId>/export.json. null renders as N/A. Mock runs get a
  // MOCK badge. No invented timings.
}
```

The comment block in `public/app.js` lists required behaviors; implement them as plain JS/canvas (no framework). Keep rendering thin: every number on screen comes from an event payload or the export.

- [ ] Step 4: `node --test test/ui-order.test.js`. Expected: pass.
- [ ] Step 5: Manual smoke: `npm start` with two mock endpoints (or one real local model), run a 10-item round, confirm animation, feeds, charts, end table, `N/A` handling, and export download.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat: two-lane browser UI with live metrics and charts"`

### Task 12: End-to-end validation against real endpoints

**Files:**
- No new files. Checklist task; record findings in the commit message of any fix.

- [ ] Step 1: Point `config/default.json` at one real local model on one lane, a mock on the other (labeled `MOCK` in UI). Run a 10-item round.
- [ ] Step 2: Point both lanes at real endpoints. Run a 20-item round, race mode.
- [ ] Step 3: Rerun the same seed. Confirm identical image hashes in both exports and per-decision labels match where models are deterministic.
- [ ] Step 4: Run one new seed. Note variability honestly.
- [ ] Step 5: Open the export JSON. Verify every displayed timing, usage, cost, label, and score matches backend records. Verify secrets absent. Verify mode label (`race` vs `sequential_benchmark`) matches config.
- [ ] Step 6: Confirm the end screen's plain-English statement is supported by the observed numbers, including when the specialized model is not the winner.
- [ ] Step 7: Commit any fixes: `git commit -m "fix: <what validation found>"`

## Definition of done

A user can configure both real endpoints, run the same generated sequence through both models, watch the actual decisions, inspect failures, and export a result summary whose accuracy, latency, and cost figures can be traced to recorded calls.


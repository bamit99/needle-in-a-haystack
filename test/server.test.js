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
    body: JSON.stringify({ hayCount: 4, needleCount: 2, seed: 's9', mode: 'sequential' }),
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
  assert.equal(exportBody.summary.mode, 'sequential_lanes'); // start body mode is honored
  assert.equal(exportBody.manifest.items.length, 6);
  assert.equal(exportBody.summary.lanes.length, 2);
  assert.equal(exportBody.summary.lanes[0].metrics.correct, 4); // 4 hay items; 2 needles labeled hay
  assert.ok(!JSON.stringify(exportBody).includes('SECRET-DO-NOT-LEAK'));

  const item = exportBody.manifest.items[0];
  const manRes = await fetch(`${base}/api/runs/${runId}/manifest`);
  assert.ok(manRes.ok, 'manifest route missing during live round');
  const liveManifest = await manRes.json();
  assert.deepEqual(liveManifest.items, exportBody.manifest.items);
  const imgRes = await fetch(`${base}/api/runs/${runId}/image/${item.imagePath}`);
  assert.ok(imgRes.ok, 'image route missing');
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(Buffer.from(await imgRes.arrayBuffer())).digest('hex');
  assert.equal(digest, item.imageSha256);

  const trav = await fetch(`${base}/%2e%2e/package.json`); // encoded ../ escape out of public/
  assert.ok(!trav.ok, 'path traversal served a file outside public/');

  const bad = await fetch(`${base}/api/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hayCount: 0, needleCount: 0, seed: 's9' }),
  });
  assert.equal(bad.status, 400);
});

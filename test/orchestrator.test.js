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

test('decision events carry what the live UI needs', async (t) => {
  const { runDir, manifest, bus } = await fixture(t);
  const a = fakeAdapter('a', () => ({ label: 'needle', latencyMs: 42, costUsd: 0.001, raw: '', status: 'ok', error: null }));
  const events = [];
  bus.on(e => events.push(e));
  await createOrchestrator({ manifest, lanes: [{ laneId: 'a', adapter: a }], config: { concurrency: 1, retries: 0 }, bus, runDir }).start();
  const decisions = events.filter(e => e.type === 'decision');
  assert.equal(decisions.length, 2);
  for (const d of decisions) {
    assert.ok(['hay', 'needle'].includes(d.predicted));
    assert.ok(['hay', 'needle'].includes(d.groundTruth));
    assert.equal(typeof d.latencyMs, 'number');
    assert.equal(d.costUsd, 0.001);
    assert.equal(d.status, 'ok');
    assert.equal(typeof d.correct, 'boolean');
  }
});

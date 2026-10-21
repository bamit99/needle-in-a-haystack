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
        let d = await lane.adapter.classify(image, { itemId: item.itemId, runId: manifest.runId });
        for (let r = 0; r < config.retries && d.status !== 'ok'; r++) {
          records.push({ itemId: item.itemId, groundTruth: item.groundTruth, predicted: d.label, status: d.status, latencyMs: d.latencyMs, costUsd: d.costUsd, confidence: d.confidence ?? null, usage: d.usage ?? null, retry: true });
          d = await lane.adapter.classify(image, { itemId: item.itemId, runId: manifest.runId, retry: r + 1 });
        }
        records.push({ itemId: item.itemId, groundTruth: item.groundTruth, predicted: d.label, status: d.status, latencyMs: d.latencyMs, costUsd: d.costUsd, confidence: d.confidence ?? null, usage: d.usage ?? null, error: d.error ?? null, retry: false });
        const correct = d.status === 'ok' && d.label === item.groundTruth;
        emit('decision', lane.laneId, item.itemId, { predicted: d.label, status: d.status, correct, groundTruth: item.groundTruth, latencyMs: d.latencyMs, costUsd: d.costUsd, confidence: d.confidence ?? null, usage: d.usage ?? null });
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

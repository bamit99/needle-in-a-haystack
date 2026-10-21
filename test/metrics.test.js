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

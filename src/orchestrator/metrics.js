export function computeLaneMetrics(records) {
  const attempted = records.length;                    // total attempts (retries included)
  const finals = records.filter((r) => !r.retry);      // exactly one row per item
  const okF = finals.filter((r) => r.status === 'ok');
  const correct = okF.filter((r) => r.predicted === r.groundTruth).length;
  const needles = finals.filter((r) => r.groundTruth === 'needle');
  const hay = finals.filter((r) => r.groundTruth === 'hay');
  const needlesDetected = needles.filter((r) => r.status === 'ok' && r.predicted === 'needle').length;
  const falsePositives = hay.filter((r) => r.status === 'ok' && r.predicted === 'needle').length;
  const needlePredictions = okF.filter((r) => r.predicted === 'needle').length;
  const hayCorrect = hay.filter((r) => r.status === 'ok' && r.predicted === 'hay').length;
  const lat = records.filter((r) => r.status === 'ok' && r.latencyMs != null).map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)] : null;
  const knownCost = records.filter((r) => r.costUsd != null);
  const totalCost = knownCost.length ? knownCost.reduce((s, r) => s + r.costUsd, 0) : null;
  return {
    attempted, items: finals.length, correct, incorrect: okF.length - correct,
    errors: finals.length - okF.length,
    needlesDetected, needlesMissed: needles.length - needlesDetected, falsePositives,
    accuracy: finals.length ? correct / finals.length : null,
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

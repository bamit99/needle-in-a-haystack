export function orderEvents(events) {
  const byLane = {};
  for (const e of events) (byLane[e.laneId ?? '_'] ??= []).push(e);
  for (const list of Object.values(byLane)) list.sort((x, y) => x.seq - y.seq);
  return byLane;
}

export function runScopedEvents(events, runId) {
  return events.filter((e) => e.runId === runId);
}

export function liveMetrics(decisions, totalItems) {
  const ok = decisions.filter((d) => d.status === 'ok');
  const lat = ok.map((d) => d.latencyMs).filter((v) => v != null).sort((a, b) => a - b);
  const costs = decisions.filter((d) => d.costUsd != null).map((d) => d.costUsd);
  const total = costs.reduce((s, v) => s + v, 0);
  return {
    done: decisions.length,
    remaining: totalItems != null ? totalItems - decisions.length : null,
    correct: ok.filter((d) => d.correct).length,
    incorrect: ok.filter((d) => !d.correct).length,
    errors: decisions.length - ok.length,
    needlesFound: ok.filter((d) => d.groundTruth === 'needle' && d.predicted === 'needle').length,
    needlesMissed: decisions.filter((d) => d.groundTruth === 'needle' && !(d.status === 'ok' && d.predicted === 'needle')).length,
    falsePositives: ok.filter((d) => d.groundTruth === 'hay' && d.predicted === 'needle').length,
    meanLatencyMs: lat.length ? Math.round(lat.reduce((s, v) => s + v, 0) / lat.length) : null,
    medianLatencyMs: lat.length ? lat[Math.ceil(lat.length / 2) - 1] : null,
    costUsd: costs.length ? total : null,
    costPerDecision: costs.length ? total / decisions.length : null,
    elapsedMs: (() => { const ts = decisions.map((d) => Date.parse(d.ts)).filter((v) => !Number.isNaN(v)); return ts.length ? Math.max(...ts) - Math.min(...ts) : null; })(),
  };
}

if (typeof document !== 'undefined') {
  const $ = (s) => document.querySelector(s);
  const NA = 'N/A';
  const fmt = (v, d = 3) => v == null ? NA : (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(d) : String(v));
  let runId = null, config = null;
  const events = [];
  const laneState = {}; // laneId -> { armX, target, decisions: [], finished }

  async function loadConfig() {
    try {
      config = await (await fetch('/api/config')).json();
    } catch {
      $('#setupWarn').textContent = 'Backend unreachable — cannot start a real-model round.';
      $('#setupWarn').classList.remove('hidden');
      $('#startBtn').disabled = true;
      return;
    }
    $('#endpoints').innerHTML = config.lanes.map((l) =>
      `<div>${l.laneId}: ${l.adapter} @ ${l.baseUrl ?? l.url}${l.model ? ' model=' + l.model : ''}${l.prompt ? ' prompt=fixed' : ''}</div>`).join('');
    if (config.mockMode) $('#mockBadge').classList.remove('hidden');
    const n = Object.keys(laneState).length;
    document.querySelectorAll('.lane').forEach((el, i) => { el.dataset.lane = config.lanes[i]?.laneId ?? `lane${i}`; });
  }

  $('#startBtn').addEventListener('click', async () => {
    if (window.__ws) window.__ws.close(); // rerun starts clean
    events.length = 0;
    $('#end').classList.add('hidden');
    const res = await fetch('/api/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hayCount: +$('#hayCount').value, needleCount: +$('#needleCount').value,
        seed: $('#seed').value || undefined, mode: $('#mode').value,
      }),
    });
    ({ runId } = await res.json());
    window.__runCount = (window.__runCount ?? 0) + 1;
    window.__manifest = await (await fetch(`/api/runs/${runId}/manifest`)).json();
    $('#lanes').classList.remove('hidden'); $('#charts').classList.remove('hidden');
    document.querySelectorAll('.lane').forEach((el, i) => { el.querySelector('h2').textContent = config?.lanes[i]?.laneId ?? el.dataset.lane; });
    const ws = window.__ws = new WebSocket(`/ws`);
    ws.onmessage = (m) => { events.push(JSON.parse(m.data)); render(); };
    ws.onclose = () => { $('#setupWarn').textContent = 'Event stream closed.'; $('#setupWarn').classList.remove('hidden'); };
  });

  function render() {
    const byLane = orderEvents(runScopedEvents(events, runId));
    for (const el of document.querySelectorAll('.lane')) {
      const list = byLane[el.dataset.lane] ?? [];
      drawLane(el, list);
      renderFeed(el, list);
      renderMetrics(el, list);
    }
    drawCharts(byLane);
    const scoped = runScopedEvents(events, runId);
    const finished = scoped.filter((e) => e.type === 'game_finished');
    if (finished.length) showEnd(finished[finished.length - 1]);
  }

  function drawLane(el, list) {
    const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const bins = { hay: [60, 180], needle: [340, 180], mistakes: [200, 180] };
    ctx.fillStyle = '#2c313a';
    for (const [x, y] of Object.values(bins)) ctx.fillRect(x - 30, y - 20, 60, 40);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillText('hay', 50, 212); ctx.fillText('needle', 330, 212); ctx.fillText('mistakes', 180, 212);
    const last = list[list.length - 1];
    if (last) {
      const armX = last.type === 'item_picked' ? 210 : last.type === 'item_dropped' ? (bins[last.bin]?.[0] ?? 210) : 210;
      ctx.fillStyle = '#dde1e7'; ctx.fillRect(armX - 2, 20, 4, 120); // arm
      ctx.beginPath(); ctx.arc(armX, 150, 6, 0, Math.PI * 2); ctx.fill();
    }
  }

  function renderFeed(el, list) {
    const feed = el.querySelector('.feed');
    const decisions = list.filter((e) => e.type === 'decision');
    feed.innerHTML = decisions.map((d) => {
      const cls = d.status !== 'ok' ? 'err' : d.correct ? '' : 'wrong';
      const img = d.itemId ? `<img src="/api/runs/${runId}/image/${imagePathFor(d.itemId)}" alt="">` : '';
      return `<li class="${cls}">${img}<span>${d.itemId}</span><span>→ ${fmt(d.predicted)}</span><span>truth ${fmt(d.groundTruth)}</span><span>${fmt(d.latencyMs, 0)} ms</span></li>`;
    }).join('');
  }

  function imagePathFor(itemId) {
    const manifest = window.__manifest;
    return manifest?.items.find((i) => i.itemId === itemId)?.imagePath ?? '';
  }

  function renderMetrics(el, list) {
    const lm = liveMetrics(list.filter((e) => e.type === 'decision'), window.__manifest?.items.length);
    const box = el.querySelector('.metrics');
    box.innerHTML = `
      <span>done ${lm.done}</span><span>remaining ${fmt(lm.remaining, 0)}</span><span>errors ${fmt(lm.errors, 0)}</span>
      <span>correct ${fmt(lm.correct, 0)}</span><span>incorrect ${fmt(lm.incorrect, 0)}</span><span>elapsed ${fmt(lm.elapsedMs, 0)} ms</span>
      <span>needles found ${fmt(lm.needlesFound, 0)}</span><span>needles missed ${fmt(lm.needlesMissed, 0)}</span><span>false pos ${fmt(lm.falsePositives, 0)}</span>
      <span>mean lat ${fmt(lm.meanLatencyMs, 0)} ms</span><span>median lat ${fmt(lm.medianLatencyMs, 0)} ms</span><span>cost ${lm.costUsd == null ? NA : '$' + lm.costUsd.toFixed(4)}</span>
      <span>cost/decision ${lm.costPerDecision == null ? NA : '$' + lm.costPerDecision.toFixed(6)}</span>`;
  }

  function drawCharts() {
    const byLane = orderEvents(runScopedEvents(events, runId));
    const ids = Object.keys(byLane).filter((k) => k !== '_');
    const palette = ['#4ea1ff', '#ffb347'];
    const allLat = ids.flatMap((id) => byLane[id].filter((e) => e.type === 'decision' && e.latencyMs != null).map((e) => e.latencyMs));
    hist($('#latChart'), ids, byLane, palette, (e) => e.latencyMs);
    accOverTime($('#accChart'), ids, byLane, palette);
    costOverTime($('#costChart'), ids, byLane, palette);
    $('#sampleNote').textContent = `Sample size: ${allLat.length} decisions total. One small round is a demonstration, not a benchmark.`;
  }

  function hist(cv, ids, byLane, palette, pick) {
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    const vals = ids.flatMap((id) => byLane[id].filter((e) => e.type === 'decision' && pick(e) != null).map(pick));
    if (!vals.length) return;
    const max = Math.max(...vals); const bins = 10;
    ids.forEach((id, i) => {
      const counts = Array(bins).fill(0);
      for (const e of byLane[id]) if (e.type === 'decision' && pick(e) != null) counts[Math.min(bins - 1, Math.floor(pick(e) / (max / bins || 1)))]++;
      ctx.fillStyle = palette[i % 2];
      counts.forEach((c, b) => ctx.fillRect(20 + i * (cv.width - 40) / ids.length + b * 12, cv.height - 10 - c * 4, 10, c * 4));
    });
  }
  function accOverTime(cv, ids, byLane, palette) {
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    ids.forEach((id, i) => {
      ctx.strokeStyle = palette[i % 2]; ctx.beginPath();
      let correct = 0, n = 0;
      byLane[id].filter((e) => e.type === 'decision').forEach((e, idx) => {
        if (e.status === 'ok' && e.correct) correct++; n++;
        const x = 20 + idx * 8, y = cv.height - 10 - (correct / n) * (cv.height - 20);
        idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    });
  }
  function costOverTime(cv, ids, byLane, palette) {
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    ids.forEach((id, i) => {
      ctx.strokeStyle = palette[i % 2]; ctx.beginPath();
      let total = 0;
      byLane[id].filter((e) => e.type === 'decision').forEach((e, idx) => {
        if (e.costUsd != null) total += e.costUsd;
        const x = 20 + idx * 8, y = cv.height - 10 - Math.min(1, total) * (cv.height - 20);
        idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    });
  }

  async function showEnd(evt) {
    const exportBody = await (await fetch(`/api/runs/${runId}/export.json`)).json();
    window.__manifest = exportBody.manifest;
    $('#end').classList.remove('hidden');
    const rows = [
      ['metric', ...exportBody.summary.lanes.map((l) => l.laneId)],
      ['accuracy', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.accuracy, 4))],
      ['needle recall', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.needleRecall, 4))],
      ['needle precision', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.needlePrecision, 4))],
      ['hay false-positive rate', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.hayFalsePositiveRate, 4))],
      ['balanced accuracy', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.balancedAccuracy, 4))],
      ['median latency (ms)', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.medianLatencyMs, 0))],
      ['p95 latency (ms)', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.p95LatencyMs, 0))],
      ['total wall time (ms)', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.totalTimeMs, 0))],
      ['cost per decision', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.costPerDecision, 6))],
      ['cost per correct decision', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.costPerCorrectDecision, 6))],
      ['throughput (dec/s)', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.throughput, 2))],
      ['errors', ...exportBody.summary.lanes.map((l) => fmt(l.metrics.errors))],
    ];
    $('#endTable').innerHTML = rows.map((r, i) => `<tr>${r.map((c) => i ? `<td>${c}</td>` : `<th>${c}</th>`).join('')}</tr>`).join('');
    const [a, b] = exportBody.summary.lanes;
    const faster = a.metrics.medianLatencyMs != null && b.metrics.medianLatencyMs != null
      ? (a.metrics.medianLatencyMs < b.metrics.medianLatencyMs ? a : b) : null;
    const qualityOk = (l) => l.metrics.balancedAccuracy != null && l.metrics.balancedAccuracy >= 0.9;
    const winner = faster && qualityOk(a) && qualityOk(b) ? faster : null;
    $('#endStatement').textContent =
      (faster ? `Faster on median latency: ${faster.laneId}. ` : 'No latency winner from this data. ') +
      (winner ? `Winner badge: ${winner.laneId} (rule: both lanes balanced accuracy >= 0.9, decided on latency).` : 'No winner badge: quality threshold not met by both lanes; see trade-offs above.');
    $('#endMeta').textContent = `seed=${exportBody.manifest.seed} mode=${exportBody.summary.mode} laneConcurrency=${exportBody.summary.laneConcurrency} runs=${window.__runCount ?? 1} renderer=v${exportBody.manifest.rendererVersion}`;
  }

  loadConfig();
}

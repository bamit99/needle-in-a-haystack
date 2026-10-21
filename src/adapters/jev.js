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

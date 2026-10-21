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

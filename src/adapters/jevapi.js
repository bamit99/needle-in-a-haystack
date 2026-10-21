import { PNG } from 'pngjs';

const DEFAULT_COLS = 48;
const DEFAULT_ROWS = 48;
const QUESTION_KEY = 'label';

/**
 * Deterministic shape rendering of a sprite: a cols x rows grid where '#' marks
 * object pixels and spaces are background. No labels, no semantics - the decision
 * is still made by the model, only the pixels it may look at are reduced.
 */
export function renderShapeMask(pngBytes, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
  const png = PNG.sync.read(pngBytes);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * png.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * png.width) / cols));
      const y0 = Math.floor((r * png.height) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * png.height) / rows));
      let hit = false;
      for (let y = y0; y < y1 && !hit; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (png.width * y + x) << 2;
          const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
          if ((R > G && G > B && R - B > 20) || (B > R && B - R >= 10)) { hit = true; break; }
        }
      }
      line += hit ? '#' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function createJevApiAdapter(cfg) {
  const questionKey = cfg.questionKey ?? QUESTION_KEY;
  return {
    async classify(image, ctx = {}) {
      const t0 = performance.now();
      try {
        const state = renderShapeMask(image, cfg.maskCols ?? DEFAULT_COLS, cfg.maskRows ?? DEFAULT_ROWS);
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
            'idempotency-key': `nihs-${ctx.runId ?? 'run'}-${ctx.itemId ?? 'item'}`,
          },
          body: JSON.stringify({
            model: cfg.model ?? 'jev-1.13',
            state,
            questions: {
              [questionKey]: {
                type: 'choice',
                instructions: cfg.instructions
                  ?? 'The state is a 48x48 binary mask of a photo: "#" marks object pixels, spaces are background. Which class is the object: hay or needle?',
                criteria: {
                  hay: 'a thick curved bundle of straw',
                  needle: 'one single thin straight metal needle',
                },
              },
            },
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        const latencyMs = Math.round(performance.now() - t0);
        const text = await res.text();
        if (!res.ok) {
          return { label: null, latencyMs, costUsd: null, confidence: null, usage: null, raw: text.slice(0, 500), status: 'provider_error', error: { httpStatus: res.status } };
        }
        let body;
        try { body = JSON.parse(text); }
        catch { return { label: null, latencyMs, costUsd: null, confidence: null, usage: null, raw: text.slice(0, 500), status: 'provider_error', error: { message: 'malformed JSON' } }; }
        const answer = body?.answers?.[questionKey];
        const choice = answer?.choice;
        const valid = choice === 'hay' || choice === 'needle';
        const u = body?.usage ?? null;
        const usage = u ? {
          inputTokens: u.input_tokens ?? null,
          chargedTokens: u.charged_tokens ?? null,
          chargedCredits: u.charged_credits ?? null,
          wallet: u.wallet ?? null,
        } : null;
        const costUsd = (cfg.pricePerMTokIn != null && usage?.chargedTokens != null)
          ? (usage.chargedTokens * cfg.pricePerMTokIn) / 1e6
          : null;
        return {
          label: valid ? choice : null,
          latencyMs,
          costUsd,
          confidence: answer?.confidence ?? null,
          usage,
          raw: String(choice ?? '').slice(0, 500),
          status: valid ? 'ok' : 'invalid_output',
          error: null,
        };
      } catch (e) {
        const latencyMs = Math.round(performance.now() - t0);
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        return { label: null, latencyMs, costUsd: null, confidence: null, usage: null, raw: '', status: timeout ? 'timeout' : 'provider_error', error: { message: e.message } };
      }
    },
  };
}

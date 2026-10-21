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

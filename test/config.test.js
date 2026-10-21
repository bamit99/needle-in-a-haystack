import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, publicConfig } from '../src/config.js';

test('loads default config and resolves two lanes', async () => {
  const cfg = await loadConfig('config/default.json');
  assert.equal(cfg.lanes.length, 2);
  assert.equal(cfg.lanes[0].prompt, 'Classify this image as exactly one of: hay, needle. Answer with one word.');
  assert.ok(cfg.lanes[1].url.startsWith('http'));
});
test('rejects missing prompt', async () => {
  const base = await loadConfig('config/default.json');
  const bad = structuredClone(base); bad.lanes[0].prompt = '';
  await assert.rejects(loadConfigFrom(bad));
});
test('publicConfig strips secrets', async () => {
  process.env.LLM_API_KEY = 'secret-x';
  const cfg = await loadConfig('config/default.json');
  assert.equal(cfg.lanes[0].apiKey, 'secret-x');
  assert.equal(publicConfig(cfg).lanes[0].apiKey, undefined);
  delete process.env.LLM_API_KEY;
});
async function loadConfigFrom(obj) {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'nihs-cfg-'));
  const p = join(dir, 'c.json');
  await writeFile(p, JSON.stringify(obj));
  return loadConfig(p);
}

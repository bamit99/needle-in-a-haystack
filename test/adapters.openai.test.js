import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createOpenAIAdapter, normalizeLabel } from '../src/adapters/openai.js';

function withMock(t, handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => t.after(() => server.close(), resolve(server.address().port)));
  });
}

test('valid one-word answer is accepted', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({
      choices: [{ message: { content: 'needle' } }],
      usage: { prompt_tokens: 100, completion_tokens: 1 },
    })));
  });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000, pricePerMTokIn: 1, pricePerMTokOut: 1 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.label, 'needle');
  assert.equal(d.status, 'ok');
  assert.ok(d.latencyMs >= 0);
  assert.equal(d.costUsd, (100 * 1 + 1 * 1) / 1e6);
});
test('verbose answer is invalid_output, not coerced (Review Focus 1)', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: 'It is a needle.' } }] })));
  });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.label, null);
  assert.equal(d.status, 'invalid_output');
});
test('missing usage means cost null, not zero (Review Focus 3)', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: 'hay' } }] })));
  });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000, pricePerMTokIn: 1, pricePerMTokOut: 1 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.label, 'hay');
  assert.equal(d.costUsd, null);
});
test('non-2xx is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => { res.statusCode = 503; res.end('busy'); }); });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 2000 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.status, 'provider_error');
  assert.equal(d.error.httpStatus, 503);
});
test('slow server is timeout', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('end', () => setTimeout(() => res.end('{}'), 300)); });
  const a = createOpenAIAdapter({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', prompt: 'p', timeoutMs: 50 });
  const d = await a.classify(Buffer.from('img'));
  assert.equal(d.status, 'timeout');
});
test('normalizeLabel: exact words only', () => {
  assert.equal(normalizeLabel('Hay'), 'hay');
  assert.equal(normalizeLabel('needle'), 'needle');
  assert.equal(normalizeLabel('It is a needle.'), null);
  assert.equal(normalizeLabel(''), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { createJevApiAdapter, renderShapeMask } from '../src/adapters/jevapi.js';

function withMock(t, handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => t.after(() => server.close(), resolve(server.address().port)));
  });
}
const adapterOn = (port, extra = {}) => createJevApiAdapter({
  url: `http://127.0.0.1:${port}/api/v1/systemone/`, model: 'jev-1.13', timeoutMs: 2000, apiKey: 'k', ...extra,
});

function needlePng() {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (64 * y + x) << 2;
    const onObject = Math.abs(x - 32) < 2 && y > 10 && y < 54;
    png.data[i] = onObject ? 90 : 120; png.data[i + 1] = onObject ? 90 : 120; png.data[i + 2] = onObject ? 110 : 120; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('renders a shape mask: object pixels marked, background blank', () => {
  const mask = renderShapeMask(needlePng());
  const lines = mask.split('\n');
  assert.equal(lines.length, 48);
  assert.ok(lines.every((l) => l.length <= 48));
  assert.ok(mask.includes('#'), 'mask has no object pixels');
  assert.ok(lines.some((l) => l.trim() === ''), 'mask has no background rows');
});

test('valid choice answer is accepted with confidence and usage', async (t) => {
  let body;
  const port = await withMock(t, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      body = JSON.parse(Buffer.concat(chunks).toString());
      res.end(JSON.stringify({
        id: 'dec_1', model: 'jev-1.13',
        answers: { label: { type: 'choice', choice: 'needle', probabilities: { hay: 0.23, needle: 0.77 }, confidence: 0.54 } },
        usage: { input_tokens: 412, output_tokens: 31, charged_tokens: 412, charged_credits: 0, wallet: 'tokens' },
        latency_ms: 436,
      }));
    });
  });
  const d = await adapterOn(port).classify(needlePng(), { itemId: 'item-000' });
  assert.equal(d.label, 'needle');
  assert.equal(d.status, 'ok');
  assert.equal(d.confidence, 0.54);
  assert.equal(d.usage.chargedTokens, 412);
  assert.equal(d.costUsd, null); // no price configured -> never zero
  assert.ok(d.latencyMs >= 0);
  // request shape: state is the mask, one choice question, key sent as bearer
  assert.ok(body.state.includes('#'));
  assert.equal(body.model, 'jev-1.13');
  assert.equal(body.questions.label.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.label.criteria), ['hay', 'needle']);
});

test('price converts charged tokens to cost; no price stays null', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({
      answers: { label: { type: 'choice', choice: 'hay', probabilities: { hay: 1, needle: 0 }, confidence: 1 } },
      usage: { input_tokens: 1000, charged_tokens: 1000, charged_credits: 0 },
    })));
  });
  const priced = await adapterOn(port, { pricePerMTokIn: 0.242 }).classify(needlePng(), { itemId: 'i' });
  assert.equal(priced.costUsd, (1000 * 0.242) / 1e6);
  const unpriced = await adapterOn(port).classify(needlePng(), { itemId: 'i' });
  assert.equal(unpriced.costUsd, null);
});

test('unknown label value is invalid_output, never coerced', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({ answers: { label: { type: 'choice', choice: 'twig', probabilities: { twig: 1 } } } })));
  });
  const d = await adapterOn(port).classify(needlePng(), { itemId: 'i' });
  assert.equal(d.status, 'invalid_output');
  assert.equal(d.label, null);
});

test('401 is provider_error and not retried silently', async (t) => {
  const port = await withMock(t, (req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'invalid key' } })); });
  });
  const d = await adapterOn(port).classify(needlePng(), { itemId: 'i' });
  assert.equal(d.status, 'provider_error');
  assert.equal(d.error.httpStatus, 401);
});

test('malformed body is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => res.end('not json')); });
  const d = await adapterOn(port).classify(needlePng(), { itemId: 'i' });
  assert.equal(d.status, 'provider_error');
});

test('slow server is timeout', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => setTimeout(() => res.end('{}'), 300)); });
  const d = await createJevApiAdapter({ url: `http://127.0.0.1:${port}/api/v1/systemone/`, model: 'jev-1.13', timeoutMs: 50, apiKey: 'k' }).classify(needlePng(), { itemId: 'i' });
  assert.equal(d.status, 'timeout');
});

test('authorization header carries the key and a run-scoped idempotency key', async (t) => {
  const seen = [];
  let lastHeaders;
  const port = await withMock(t, (req, res) => {
    seen.push(req.headers['idempotency-key']);
    lastHeaders = req.headers;
    req.on('data', () => {});
    req.on('end', () => res.end(JSON.stringify({ answers: { label: { type: 'choice', choice: 'hay', probabilities: { hay: 1, needle: 0 }, confidence: 1 } }, usage: {} })));
  });
  const a = adapterOn(port);
  await a.classify(needlePng(), { itemId: 'item-007', runId: 'run-1' });
  await a.classify(needlePng(), { itemId: 'item-007', runId: 'run-1' }); // retry of the same request: same key
  await a.classify(needlePng(), { itemId: 'item-007', runId: 'run-2' }); // a later run: different key
  assert.equal(seen[0], seen[1], 'retry must reuse the key so a repeat is not charged twice');
  assert.notEqual(seen[0], seen[2], 'a new run must not reuse an old key');
  assert.equal(lastHeaders.authorization, 'Bearer k');
  assert.ok(seen[0].includes('run-1') && seen[0].includes('item-007'));
});

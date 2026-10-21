import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createJevAdapter } from '../src/adapters/jev.js';

function withMock(t, handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => t.after(() => server.close(), resolve(server.address().port)));
  });
}
const adapterOn = (port, extra = {}) => createJevAdapter({ url: `http://127.0.0.1:${port}/classify`, timeoutMs: 2000, ...extra });

test('valid label accepted, raw body received', async (t) => {
  let received;
  const port = await withMock(t, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received = Buffer.concat(chunks); res.end('{"label":"needle"}'); });
  });
  const d = await adapterOn(port).classify(Buffer.from('PNGDATA'));
  assert.equal(received.toString(), 'PNGDATA');
  assert.equal(d.label, 'needle');
  assert.equal(d.status, 'ok');
  assert.ok(d.latencyMs >= 0);
});
test('unconfigured cost stays null, never zero', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => res.end('{"label":"hay"}')); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.costUsd, null);
});
test('configured per-call cost is reported', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => res.end('{"label":"hay"}')); });
  const d = await adapterOn(port, { costUsdPerCall: 0.0002 }).classify(Buffer.from('x'));
  assert.equal(d.costUsd, 0.0002);
});
test('unknown label value is invalid_output', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => res.end('{"label":"twig"}')); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.status, 'invalid_output');
  assert.equal(d.label, null);
});
test('malformed JSON is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => res.end('not json')); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.status, 'provider_error');
});
test('non-2xx is provider_error', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => { res.statusCode = 500; res.end(); }); });
  const d = await adapterOn(port).classify(Buffer.from('x'));
  assert.equal(d.status, 'provider_error');
});
test('slow server is timeout', async (t) => {
  const port = await withMock(t, (req, res) => { req.on('data', () => {}); req.on('end', () => setTimeout(() => res.end('{}'), 300)); });
  const d = await createJevAdapter({ url: `http://127.0.0.1:${port}/classify`, timeoutMs: 50 }).classify(Buffer.from('x'));
  assert.equal(d.status, 'timeout');
});

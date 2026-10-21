import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig, publicConfig } from './config.js';
import { buildManifest } from './generator/manifest.js';
import { createOpenAIAdapter } from './adapters/openai.js';
import { createJevAdapter } from './adapters/jev.js';
import { createJevApiAdapter } from './adapters/jevapi.js';
import { createEventBus } from './orchestrator/events.js';
import { createOrchestrator } from './orchestrator/orchestrator.js';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

export function createApp({ config, adapterFactory }) {
  const bus = createEventBus();
  const runs = new Map(); // runId -> { manifest, summaryPromise, runDir }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/start') {
      const body = JSON.parse(await readBody(req));
      const hayCount = Number(body.hayCount), needleCount = Number(body.needleCount);
      if (!Number.isInteger(hayCount) || hayCount < 1 || !Number.isInteger(needleCount) || needleCount < 1) {
        res.statusCode = 400; res.end(); return;
      }
      const runDir = join(config.runsDir ?? 'runs', `run-${Date.now()}`);
      const manifest = await buildManifest({ hayCount, needleCount, seed: body.seed ?? String(Date.now()), outDir: runDir, imageSize: config.imageSize });
      const lanes = config.lanes.map((lane) => ({ laneId: lane.laneId, adapter: adapterFactory(lane) }));
      const orch = createOrchestrator({ manifest, lanes, config: { ...config, sequentialLanes: body.mode === 'sequential' }, bus, runDir });
      const entry = { manifest, runDir, summaryPromise: orch.start() };
      runs.set(manifest.runId, entry);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ runId: manifest.runId }));
      return;
    }
    const exportMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/export\.json$/);
    if (exportMatch) {
      const entry = runs.get(exportMatch[1]);
      if (!entry) { res.statusCode = 404; res.end(); return; }
      const summary = await entry.summaryPromise;
      if (!summary) { res.statusCode = 409; res.end(); return; } // still running
      const records = {};
      for (const lane of config.lanes) {
        records[lane.laneId] = (await readFile(join(entry.runDir, `${lane.laneId}.jsonl`), 'utf8'))
          .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ manifest: entry.manifest, config: publicConfig(config), summary, records }));
      return;
    }
    const manifestMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/manifest$/);
    if (manifestMatch) {
      const entry = runs.get(manifestMatch[1]);
      if (!entry) { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(entry.manifest));
      return;
    }
    const imageMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/image\/([A-Za-z0-9._-]+)$/);
    if (imageMatch) {
      const entry = runs.get(imageMatch[1]);
      if (!entry) { res.statusCode = 404; res.end(); return; }
      const item = entry.manifest.items.find((i) => i.imagePath === imageMatch[2]);
      if (!item) { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', 'image/png');
      res.end(await readFile(join(entry.runDir, item.imagePath)));
      return;
    }
    if (url.pathname === '/api/config') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(publicConfig(config)));
      return;
    }
    // static from public/, guarded against path escape
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = resolve(join('public', file));
    if (!full.startsWith(resolve('public') + sep)) { res.statusCode = 404; res.end(); return; }
    try {
      const data = await readFile(full);
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      res.end(data);
    } catch { res.statusCode = 404; res.end(); }
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
  }
  return { app: handle, bus };
}

export async function startServer({ config, adapterFactory, port = 8787 }) {
  const { app, bus } = createApp({ config, adapterFactory });
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', (err) => reject(
      err.code === 'EADDRINUSE'
        ? new Error(`port ${port} is already in use - stop the other instance or pick another port`)
        : err,
    ));
    server.listen(port, resolve);
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  bus.on((event) => {
    const msg = JSON.stringify(event);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  });
  return { server, bus, wss };
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const config = await loadConfig('config/default.json');
  const adapterFactory = (lane) => (
    lane.adapter === 'openai' ? createOpenAIAdapter(lane)
      : lane.adapter === 'jevapi' ? createJevApiAdapter(lane)
        : createJevAdapter(lane)
  );
  const { server } = await startServer({ config, adapterFactory });
  console.log('NIHS on http://localhost:8787');
}

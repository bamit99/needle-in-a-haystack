import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig, publicConfig } from './config.js';
import { buildManifest } from './generator/manifest.js';
import { createOpenAIAdapter } from './adapters/openai.js';
import { createJevAdapter } from './adapters/jev.js';
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
      const runDir = join(config.runsDir ?? 'runs', `run-${Date.now()}`);
      const manifest = await buildManifest({ hayCount: body.hayCount, needleCount: body.needleCount, seed: body.seed ?? String(Date.now()), outDir: runDir });
      const lanes = config.lanes.map((lane) => ({ laneId: lane.laneId, adapter: adapterFactory(lane) }));
      const orch = createOrchestrator({ manifest, lanes, config, bus, runDir });
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
    if (url.pathname === '/api/config') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(publicConfig(config)));
      return;
    }
    // static from public/
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    try {
      const data = await readFile(join('public', file));
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

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const config = await loadConfig('config/default.json');
  const adapterFactory = (lane) => (lane.adapter === 'openai' ? createOpenAIAdapter(lane) : createJevAdapter(lane));
  const { app, bus } = createApp({ config, adapterFactory });
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  bus.on((event) => { const msg = JSON.stringify(event); for (const c of wss.clients) if (c.readyState === 1) c.send(msg); });
  server.listen(8787, () => console.log('NIHS on http://localhost:8787'));
}

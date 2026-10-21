# 🧵 Needle in a Haystack

**A two-lane race between a general-purpose multimodal chat model and a specialised decision model — real API calls, real images, real numbers.**

Both lanes get the same pile of hay and needles, in the same shuffled order. Each lane picks one
item at a time, decides *hay* or *needle*, and drops it in a bin. The needles might show up first,
or on item 37. You watch both lanes crawl at their own honest pace — then the game shows you who
was faster, who was cheaper, and who was right.

```
  ┌──────────────────────────────┐        ┌──────────────────────────────┐
  │  llm  (multimodal chat model)│        │  jev  (decision model)       │
  │                              │        │                              │
  │        ┌────┐                │        │                ┌────┐        │
  │   ╱────┤    ├────╲           │        │           ╱────┤    ├────╲   │
  │  ╱     │    │     ╲          │        │          ╱     │    │     ╲  │
  │ ╱      └────┘      ╲         │        │         ╱      └────┘      ╲ │
  │ │   hay        needle │       │        │        │   hay        needle │
  └──────────────────────────────┘        └──────────────────────────────┘
```

![a local run of the game](docs/screenshot.png)

<sub>_A local run against **stub endpoints** — the lane answers come from a local mock, while the layout,
the charts and the end-of-round table are the real thing. Stub numbers are not model results._</sub>

---

## What it compares — and what it does not

The two lanes are the same *task* under very different *systems*:

| | chat lane | decision lane (`jevapi`) |
|---|---|---|
| model | general-purpose multimodal chat model (e.g. a vision-capable LLM) | specialised decision model (Jev-style API) |
| input it receives | the **PNG image** | a **48×48 shape mask** (text) — the hosted API takes text only |
| where it runs | wherever you point it (here: Ollama, a cloud model) | a hosted HTTP API |
| answer shape | one word, validated strictly | a calibrated distribution over `hay` / `needle` |

So the numbers below compare **two systems**, not two models in isolation. Where the two lanes
see different representations of the same item, we say so instead of pretending otherwise.

## Validation summary

| area | state | evidence |
|---|---|---|
| app, UI, per-lane live rendering | works | browser run against stub endpoints (screenshot above) |
| metrics (accuracy, recall, precision, FPR, balanced, null-safe cost/latency) | works | `node:test` suite, 51 tests, `npm test` green |
| export pipeline (manifest + summary + per-item records, secrets stripped) | works | `/api/runs/:id/export.json`; keys never appear in it |
| **real** inference — chat lane | works | 2 rounds × 10 items against a real vision model |
| **real** inference — hosted decision lane | partial | 1 round where 6 of 10 items were answered, then `HTTP 402` (account out of credits); plus 2 direct API probes |
| **mock** only | UI screenshot, adapter unit tests (in-process mock HTTP servers) | — |
| outstanding | a round where both lanes answer every item; the decision lane has not been re-measured on the current sprites; the UI does not flag the mask conversion (it shows the endpoint, the adapter name is in the export) | — |

## Quickstart

**Prerequisites:** Node.js 20+ (developed on 20 and 24) and npm. No native build tools, no
database, no GPU required by the app itself.

```bash
npm install
npm start        # → http://localhost:8787
```

Open the page, choose how many hay and needles, hit **Start**, and watch. `npm start` serves the
game and the API; `npm test` runs the suite.

### Point the lanes at something

Edit `config/default.json` (this is the file as shipped):

```json
{
  "lanes": [
    {
      "laneId": "llm",
      "adapter": "openai",
      "baseUrl": "http://localhost:11434/v1",
      "model": "minimax-m3.1-flash:cloud",
      "apiKeyEnv": "LLM_API_KEY",
      "prompt": "Classify this image as exactly one of: hay, needle. Answer with one word.",
      "timeoutMs": 30000,
      "pricePerMTokIn": null,
      "pricePerMTokOut": null
    },
    {
      "laneId": "jev",
      "adapter": "jevapi",
      "url": "https://jev-ai.org/api/v1/systemone/",
      "model": "jev-1.13",
      "apiKeyEnv": "JEV_API_KEY",
      "questionKey": "label",
      "timeoutMs": 30000,
      "pricePerMTokIn": null
    }
  ],
  "imageSize": 256,
  "concurrency": 1,
  "retries": 0
}
```

* **Chat lane** — any OpenAI-compatible endpoint (Ollama, llama.cpp, LM Studio, vLLM, OpenAI).
  It must accept images: `ollama pull minimax-m3.1-flash:cloud` (or any other vision-capable
  model). `beam:cloud` does **not** — Ollama answers `HTTP 400 "this model does not support
  image input"`. `baseUrl` can be any reachable host, e.g. `http://192.168.0.5:11434/v1`.
* **Decision lane** — the hosted Jev decision API. Needs a key; the API key lives in the
  environment, never in the config file:

  ```bash
  export JEV_API_KEY=...     # hosted decision API
  export LLM_API_KEY=...     # only if your chat endpoint wants one
  npm start
  ```

* **Cost** — leave `pricePerMTokIn` / `pricePerMTokOut` / `pricePerMTokIn` (decision lane) as
  `null` unless you know the real numbers. Unknown cost is reported as **N/A**, never as `$0`.

### Real run vs mock run

A **real run** is the app talking to real endpoints: every item is one real request, and
latency/cost come from the responses. A **mock run** means the endpoints are stubs (as in the
screenshot) — useful for exercising the UI, but the accuracy shown is the mock's accuracy, not a
model's. The automated tests use in-process mock HTTP servers for the same reason; they verify
the game, not the models.

## Results

All numbers below were produced by this repo on **2026-10-21**. Two runs are shown: the current
one, and the earlier one that the sprite fix superseded.

### Latest run — renderer v2 (legible sprites)

| | value |
|---|---|
| date | 2026-10-21 |
| items | 10 (7 hay + 3 needle) |
| seeds | `legible-1`, `legible-2` |
| renderer | v2 (legible sprites) |
| mode | `race`, lane concurrency 1 |
| chat lane | Ollama (OpenAI-compatible, LAN host), model `minimax-m3.1-flash:cloud`, **image** input |
| decision lane | *not measured in this run* — the hosted account was out of credits |

| lane | seed | accuracy | balanced acc | needle recall | needle precision | median | p95 | errors | cost |
|---|---|---|---|---|---|---|---|---|---|
| chat | `legible-1` | 1.00 | 1.00 | 1.00 | 1.00 | 3749 ms | 7956 ms | 0 | N/A |
| chat | `legible-2` | 0.90 | 0.93 | 1.00 | 0.75 | 3180 ms | 4938 ms | 0 | N/A |

### Earlier run — renderer v1 (superseded)

| | value |
|---|---|
| date | 2026-10-21 |
| items | 10 (7 hay + 3 needle) |
| seed | `hosted-1` |
| renderer | v1 (thin sprites) |
| mode | `race`, lane concurrency 1 |
| chat lane | same endpoint and model as above, **image** input |
| decision lane | hosted `jev-1.13` at `jev-ai.org`, **48×48 mask** input, 1 credit per call (no USD price known → cost N/A) |
| decision lane outcome | 6 answers, then 4 × `HTTP 402` (account out of credits) — failed calls are not charged |

| lane | answered | accuracy (all 10 attempted) | balanced acc | median | p95 | errors | cost |
|---|---|---|---|---|---|---|---|
| chat | 10/10 | 0.30 | 0.50 | 2017 ms | 7053 ms | 0 | N/A |
| decision | 6/10 (3 of 6 correct) | 0.30 | 0.31 | 9009 ms | 13069 ms | 4 | N/A (1 credit/call) |

### Direct API probes (not game rounds)

* Hosted decision API, 2 mask decisions: both correct (confidence 0.54 / 0.56); the service
  reports `latency_ms` 436–832 while the wall clock was 9.3–13.4 s; 1 credit each.
* A replayed idempotency key was rejected with `HTTP 409` — keys are now scoped per run, and a
  retry reuses its key so a repeat is never charged twice.
* After the credits ran out, calls failed with `HTTP 402`; failed calls are not charged, and the
  game records them as errors instead of zeroes.
* Local Ollama `nimble:latest` (a text-only decision model) was also probed: 2 ASCII-mask
  decisions, both correct, confidence 0.07–0.23, warm 0.3–0.7 s. It is **not** wired into the
  game.

### What these numbers do and do not establish

* They **do not** show a specialised model beating a general one. On the one run where both
  lanes were live, the chat lane was faster (2.0 s vs 9.0 s median). Accuracy is not comparable
  there: the decision lane answered 6 of 10 items (3 correct) and the other 4 were errors, and it
  has not been re-measured on the current sprites at all. No current head-to-head accuracy claim
  exists.
* The decision lane's ~9 s is dominated by the hosted service's own per-call overhead: it reports
  0.44 s of inference, and a plain `GET` to the same host takes 0.9 s.
* The lanes do **not** see the same thing (image vs mask), so even a same-round comparison is a
  comparison of *systems*.
* No parameter counts are claimed for either model, and "specialised" describes the *interface*
  (a decision API that scores options instead of generating text), not a size.
* One 10-item round is a demonstration, not a benchmark.

### One finding worth keeping

Our first hay was too good: a 1–2 px straw on a grey gradient disappears when a vision model
downsamples it, so both lanes scored ~0.3 and the game was measuring noise. After making the
sprites legible (thicker shapes, real contrast, a flat background — and a test that downscales
the sprite the way a model does), the chat lane jumped to 0.9–1.0. If a model looks bad here,
check the hay before blaming the model.

### The `jevapi` lane reads shapes, not pixels

The hosted decision API takes **text** as its state — it has no image field. That lane therefore
receives a deterministic 48×48 mask of the sprite: `#` marks object pixels, spaces are
background, no labels and no colour words. The mask is dumb; the decision is the model's. The
conversion lives in `src/adapters/jevapi.js`, and the lane's adapter name and endpoint appear in
the UI and in the export's config snapshot.

```
####################
####################
        ####
        ####
         ##
```

Want a decision lane that truly sees pixels? Write a small service for the `jev` adapter that
forwards the PNG bytes to a local multimodal decision model.

## What the game refuses to do

- ❌ Simulate a decision. Every item is a real call.
- ❌ Call an unknown cost `$0`. Unknown cost is `null` and shows as **N/A**.
- ❌ Coerce a chatty answer. `"It is a needle."` is recorded as `invalid_output`, not `needle`.
- ❌ Drop failures from the maths. Errors stay in the denominators.
- ❌ Show `0` for "no needles were predicted" — that is `null` too.
- ❌ Hand out a winner badge unless both lanes clear a quality bar.
- ❌ Mix a re-run into the previous run's state.
- ❌ Leak a key into the browser or the export.

## The numbers it keeps

Accuracy, needle recall, needle precision, hay false-positive rate, balanced accuracy,
mean/median/p95 latency, throughput, cost per decision, cost per correct decision, and the error
count. Every round writes `runs/<run>/` with the sprite PNGs, `manifest.json` and one JSONL per
lane; the full summary is served at `/api/runs/:id/export.json` (manifest, public config
snapshot, summary, and every per-item record).

## Layout

```
src/generator/    seeded sprite rasterizer + manifest builder (no native deps)
src/adapters/     openai · jev · jevapi
src/orchestrator/ lanes, metrics, event bus
src/server.js     http + websocket + export
public/           the game (plain HTML/canvas, no framework)
config/           default.json
test/             node:test suites
```

```bash
npm test          # 51 tests: node:test, no framework
```

## Docs

- [`docs/superpowers/specs/2026-10-21-needle-in-haystack-game-design-revised.md`](docs/superpowers/specs/2026-10-21-needle-in-haystack-game-design-revised.md) — the design this was built from
- [`docs/superpowers/plans/2026-10-21-needle-in-haystack-game.md`](docs/superpowers/plans/2026-10-21-needle-in-haystack-game.md) — the build plan it was executed from
- [`docs/superpowers/handoff-2026-10-21.md`](docs/superpowers/handoff-2026-10-21.md) — state, gotchas, what is still open

## License

MIT — see [LICENSE](LICENSE).

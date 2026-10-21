# Needle in a Haystack — Game Design Spec

**Date:** 2026-10-21  
**Status:** Revised implementation specification  
**Purpose:** Demonstrate why a purpose-built decision model can outperform a general-purpose chat LLM on a narrow, repeated classification task.

## 1. Product intent

Needle in a Haystack is a visual, real-inference demonstration of the difference between:

- **General-purpose chat LLM:** a capable model accessed through an OpenAI-compatible chat-completions API, asked to inspect an image and answer “needle” or “hay”.
- **Jev-style decision model:** a model designed to make a narrow decision directly, through a lightweight classification interface.

Both systems process the exact same sequence of generated images. Each decision is a real model call. The game makes the differences in **decision latency, operating cost, and classification quality** visible.

The intended message is not that a specialized model wins every possible task. It is that routing a simple, repeated decision to a model designed for that decision can avoid the overhead of using a general-purpose conversational model—provided decision quality remains fit for purpose.

**Core demo claim:** For this narrow binary task, a Jev-style decision model can deliver faster and cheaper decisions while maintaining acceptable accuracy. The results shown must come from the actual run; never hard-code or simulate a winner.

## 2. Player experience

Two parallel lanes run side by side. Each lane receives the same item, makes its own decision, and drops the item into the predicted bin.

- Hay is routed to the hay bin.
- Needles are routed to the needle bin.
- Incorrect decisions and failed requests go to a mistakes tray, with the prediction and ground truth shown.
- The item sequence is identical for both lanes, but each lane advances at its own real measured pace.
- The game ends when both lanes have processed the full sequence.

This is a **classification race**, not a first-needle-wins search. Every item is processed so the comparison includes false positives as well as missed needles.

## 3. Scope and non-goals

### In scope

- 10–200 generated items per round.
- One or more needles and a configurable number of hay items.
- Seeded, reproducible image generation.
- Real calls to both model endpoints for every item.
- Independent lane execution and failure handling.
- Live metrics, decision feeds, charts, and an end-of-round comparison.
- Exportable run results for repeatability and review.

### Out of scope for the first version

- Real-world photo datasets.
- Additional object classes.
- Leaderboards, sound, mobile-first layout, or simulated model decisions.
- Claims about performance on unrelated enterprise tasks based solely on this synthetic benchmark.
- A “find the first needle and stop” mode. That can be a separate future game mode with its own scoring rules.

## 4. Experimental design and fairness

The demo should make a persuasive comparison without rigging the experiment.

### Shared inputs

1. Generate one shuffled sequence from a recorded random seed.
2. Render each item once and persist its image and ground-truth label.
3. Send the exact same image bytes to both adapters, unless an adapter requires a documented transport encoding.
4. Keep each lane's queue and state independent.
5. Record the image hash and item ID for each decision so the shared input can be verified.

### Model configuration

For every run, record:

- Model name and version, when available.
- Endpoint type and relevant deployment identifier.
- Prompt and system instructions for the chat model.
- Image dimensions and any preprocessing.
- Generation/decoding settings, timeout, and retry policy.
- Start/end timestamps and request outcome.
- Pricing assumptions and how costs are calculated.

Use the same visual information for both models. The chat model gets a fixed, concise prompt: **“Classify this image as exactly one of: hay, needle. Answer with one word.”** Validate its output rather than assuming the response always follows the instruction.

Do not deliberately degrade the chat baseline. The purpose is to show the practical trade-off between a general-purpose model and a task-specific decision model, not to create a straw-man comparison.

### Repeated runs

A single round is an entertaining demonstration, not conclusive benchmark evidence. Allow the operator to rerun with the same seed and with new seeds. Report the number of runs and the tested configurations. Keep a small held-out set of seeds for validation after tuning the sprite generator.

### Concurrency and load

The two lanes should run concurrently to preserve the race experience. Since concurrent calls can affect latency, record that fact and keep the runtime environment as consistent as practical. For repeatable benchmark runs, provide a sequential measurement option or rerun the experiment under the same concurrency conditions. Clearly distinguish race wall-clock time from per-request latency.

## 5. Sprite generator

The backend contains a deterministic, seeded renderer that produces PNGs for exactly two classes: `hay` and `needle`.

Vary rotation, scale, position, lighting, texture, and partial occlusion within controlled bounds. The renderer must avoid making the needle trivially identifiable by a single accidental cue, such as a unique background, border, or color that never appears in hay images.

Each generated item stores:

- `itemId`
- `seed`
- `groundTruth`: `hay` or `needle`
- `imagePath` or stored image bytes
- `imageSha256`
- Renderer version and relevant parameters

The same seed and renderer version must reproduce the same sequence and image hashes. Reserve some seeds for validation rather than repeatedly adjusting the renderer against every evaluation image.

## 6. Architecture

### Browser UI

HTML/JavaScript with canvas animation. The UI contains:

- Setup controls.
- Two sorting lanes, pick arms, and bins.
- Per-lane live metrics and decision feeds.
- Mistakes tray.
- Latency and accuracy charts.
- Final comparison and run metadata.

Animation follows backend events. It may smooth transitions for readability, but it must not invent model thinking time or alter the displayed measured duration.

### Thin Node backend

The backend owns image generation, model calls, orchestration, scoring, and the event stream.

#### Adapter interface

Both adapters implement the same conceptual contract:

`classify(image, context) -> { label, latencyMs, costUsd, raw, status, error }`

Where:

- `label` is `hay`, `needle`, or `null` when no valid decision was produced.
- `latencyMs` is measured using a consistent, documented boundary.
- `costUsd` is the estimated attributable request cost; unknown cost is `null`, not zero.
- `raw` stores a safely truncated response or a reference to it.
- `status` distinguishes success, invalid output, timeout, and provider error.
- `error` contains a structured, non-secret diagnostic.

#### Chat LLM adapter

- Uses `POST /v1/chat/completions`.
- Sends the image using the endpoint's supported image-message format.
- Uses the fixed prompt defined above.
- Records usage tokens when returned and estimates cost using versioned configuration rates.
- Parses and validates the answer. An invalid answer is not silently converted into a correct label.

#### Jev-style adapter

- Sends the PNG bytes to the configured HTTP endpoint.
- Expects JSON such as `{"label":"hay"}` or `{"label":"needle"}`.
- Validates the response schema and label.
- Records measured request latency.
- Reports direct API charges when applicable. For self-hosted inference, the API cost may be zero, but the run report must not imply that compute is economically free.

### Orchestrator

- Builds and persists the shuffled item sequence.
- Renders each sprite once.
- Dispatches the same item to both lanes.
- Records per-lane request, response, score, timing, and cost.
- Publishes events to the UI.
- Continues one lane if the other fails.
- Uses bounded concurrency and configurable timeouts.
- Retries only when explicitly enabled. Retries are recorded and included in cost and timing accounting.

### Event channel

WebSocket events:

- `game_started`
- `item_picked`
- `decision`
- `item_dropped`
- `lane_finished`
- `game_finished`

Every event should include `runId`, `laneId`, `itemId`, and a monotonically increasing lane sequence number where relevant. Include timestamps so the UI can handle delayed or out-of-order events safely.

### Configuration

Keep endpoint URLs, credentials, prompts, image settings, timeouts, concurrency, retry rules, model identifiers, and pricing rates in configuration. Never expose secrets to the browser or include them in exported run results.

## 7. Scoring and metrics

The generator's label is the sole ground truth. Never trust model self-report to determine correctness.

### Live metrics per lane

- Items completed and remaining.
- Correct decisions and incorrect decisions.
- Needles detected and needles missed.
- False-positive needle predictions.
- Mean and median request latency.
- Total lane wall-clock time.
- Total attributable cost and cost per decision.
- Error and invalid-output counts.

### End-of-round metrics

Report the following side by side:

| Metric | Definition | Why it matters |
|---|---|---|
| Overall accuracy | Correct decisions / all items | Useful, but can hide missed needles |
| Needle recall | True needles classified as needle / all true needles | Measures how many needles were found |
| Needle precision | True needle predictions / all needle predictions | Measures how often a needle alert was correct |
| Hay false-positive rate | Hay items classified as needle / all hay items | Measures unnecessary alerts |
| Balanced accuracy | Mean of hay recall and needle recall | Reduces distortion from class imbalance |
| Median latency | Median measured request latency | Shows typical decision speed |
| P95 latency | 95th percentile request latency | Shows slow-tail behaviour |
| Total wall-clock time | Time for the lane to finish | Shows practical round duration |
| Cost per decision | Attributable total cost / attempted decisions | Shows unit economics |
| Cost per correct decision | Attributable total cost / correct decisions | Combines cost and useful output |
| Throughput | Completed decisions / elapsed time | Shows processing rate |

Use `N/A` when a metric is undefined—for example, needle precision when the model never predicts a needle. Do not display undefined values as zero.

For cost accounting:
- Separate provider/API charges from estimated self-hosted compute costs.
- State the source and date of price rates.
- Include retries and failed requests in attributable cost where charges may have been incurred.
- If compute cost is not measured, show it as unavailable rather than claiming total cost is zero.

### Error handling and scoring

Timeouts, transport failures, malformed JSON, and invalid labels are recorded as errors. The item goes to the mistakes tray and the lane continues. An error is not silently retried unless retries are enabled and recorded.

For classification-quality metrics, report errors separately and also show the effective operational outcome. Do not quietly remove failed requests from the denominator in a way that makes a less reliable system look more accurate.

## 8. UI and visual design

### Setup screen

- Hay count and needle count.
- Random seed, with an option to reuse a seed.
- Model names/endpoints and connection status.
- Model and prompt identifiers.
- Run mode: race or controlled benchmark.
- Start button.

Show a clear warning if an endpoint is unconfigured or cannot be reached. Do not start a purported real-model round using mock results without an explicit “mock mode” label.

### During the round

Each lane shows:

- Current item and pick/drop animation.
- Predicted label and ground truth after the decision is complete.
- Correct/incorrect/error state.
- Completed decisions, quality metrics, median latency, and cost.
- Decision feed with item thumbnail and request outcome.

Wrong decisions and errors are visually distinct. A fast but inaccurate model must not appear to win merely because its lane finishes first.

### Charts

- Latency distribution, with comparable axes.
- Quality over time, including needle recall where the sample size supports it.
- Cost accumulated over the round.
- Optional throughput comparison.

Clearly label sample sizes and avoid implying statistical certainty from one small round.

### End screen

Show:
1. A side-by-side metric table.
2. A clear statement of which model was faster, if the measured data supports that statement.
3. Accuracy and needle-detection trade-offs.
4. Total and per-decision cost with accounting assumptions.
5. Errors, timeouts, and retries.
6. Run seed, model versions, prompts/configuration identifiers, and number of runs.
7. A short, automatically generated explanation based only on observed results.

Do not force a single overall winner score. If a winner badge is used, define its rule in advance and require minimum classification-quality thresholds before speed or cost can decide the outcome.

## 9. Testing

### Unit tests

- Same seed and renderer version produce identical images and labels.
- Image hashes match across the two lanes.
- Metrics correctly handle class imbalance, missed needles, false positives, and undefined precision/recall.
- Invalid model outputs and failures are scored consistently.
- Pricing calculations account for usage, retries, and unknown values.

### Adapter contract tests

- OpenAI-compatible mock server.
- Jev-style HTTP mock server.
- Valid labels, invalid labels, malformed JSON, timeouts, non-2xx responses, and missing usage metadata.

Mocks are for automated tests only. The UI must label mock runs clearly and never present them as live-model evidence.

### Orchestrator tests

- Both lanes receive the identical item sequence.
- Lanes can finish at different times.
- One lane can fail without stopping the other.
- Event ordering and request correlation remain correct.
- Retry behaviour follows configuration.
- A final summary is generated even if some requests fail.

### Manual validation

Run a small game against one real local model, then run both real adapters. Verify that the displayed timing, usage, cost, labels, and final scores match backend records.

## 10. Interpretation and intended takeaway

The demo is designed to illustrate the value of specialization in narrow, repeated decision tasks. Its strongest result is a Jev-style model that is materially faster and cheaper while preserving acceptable needle detection and false-positive performance.

Possible outcomes must be represented honestly:

- **Faster, cheaper, comparable quality:** Strong evidence for using the specialized model on this task.
- **Faster and cheaper, but worse detection:** A trade-off, not an unqualified win.
- **Similar latency or cost:** No demonstrated efficiency advantage under the tested setup.
- **Results vary across seeds or runs:** Show the variability and investigate before making a broad claim.

Synthetic images can establish results only for this controlled task. They do not, by themselves, establish superiority on unrelated real-world workloads. The intended architectural lesson is that a narrow decision should not automatically require the full overhead of a general-purpose chat interaction.

## 11. Implementation order

1. Build the deterministic sprite generator and ground-truth manifest.
2. Implement both adapters and contract tests.
3. Build the orchestrator and durable per-decision records.
4. Implement scoring and metric tests before adding visual polish.
5. Connect the WebSocket event stream to the two-lane UI.
6. Add setup, live metrics, charts, and the end screen.
7. Validate with real endpoints and repeatable seeds.
8. Run a manual playtest and confirm every displayed number comes from measured results.

**Definition of done:** A user can configure both real endpoints, run the same generated sequence through both models, watch the actual decisions, inspect failures, and export a result summary whose accuracy, latency, and cost figures can be traced to recorded calls.

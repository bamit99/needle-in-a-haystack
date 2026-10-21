# Needle in a Haystack — Game Design Spec

Date: 2026-10-21
Status: approved in conversation, pending written review

## Purpose

A visual game that demonstrates the difference between a standard chat LLM and a
"Jev-style" decision model on a simple, repeated decision task. Both models sort
the same haystack item by item. The point of the demo: a small model built for
narrow decisions is faster, cheaper, and more reliable per decision than a big
chat model doing the same job.

## Player-facing concept

The game starts with a random number of hay items and needles. A pick arm takes
each item in turn, the model decides "hay" or "needle", and the item drops into
the matching container. The needle may appear on the first pick or much later.
Two lanes run side by side — one per model — over the identical shuffled
sequence, each at its own speed.

## Architecture

- **Browser game UI** (HTML/JS, canvas animation): two lanes, pick arm, bins,
  decision feeds, charts, end screen.
- **Thin Node backend** owns everything real:
  - **Sprite generator** — deterministic, seeded renderer producing PNG images
    of exactly two classes: hay and needle. Rotation and lighting noise vary
    per item; the ground-truth label is recorded at render time.
  - **Adapter layer** — two implementations behind one interface:
    - OpenAI-compatible adapter for the standard chat LLM
      (`POST /v1/chat/completions`, image as base64 in the user message).
    - Generic HTTP adapter for the Jev-style model: `POST` the PNG bytes,
      expect JSON `{"label": "hay"|"needle"}`.
  - **Orchestrator** — builds the shuffled sequence, renders each sprite once,
    feeds both lanes the identical item stream. Per lane loop: pick next item,
    call adapter, record decision, latency, and cost, publish drop event.
  - **Event channel** — WebSocket to the UI: `item_picked`, `decision`,
    `item_dropped`, `lane_finished`, `game_finished`.
- **Config file** — model endpoints, prompts, image size, timeouts, cost rates.

## Game flow

1. Setup screen: number of hay, number of needles, random seed, both endpoints
   shown. Start.
2. Backend builds the shuffled sequence and renders all sprites.
3. Both lanes run concurrently and independently. Lane loop: pick next item,
   send to model, show thinking time, drop into hay bin or needle bin.
4. Correct needle decision: bin glows, counter ticks. Wrong decision: item goes
   to the mistakes tray with the model's answer and the truth shown.
5. A lane finishes when its queue is empty. End screen shows the side-by-side
   results table.

Only two item classes exist: hay and needle. No distractor items.

## Models and prompts

- Chat LLM adapter prompt: show the image, ask "Needle or hay? Answer one
  word." Prompt and completion tokens are recorded and priced from config.
- Jev adapter: no token cost; latency is the measured story.
- Shared adapter interface: `classify(image) -> { label, latencyMs, costUsd, raw }`.
- Ground truth comes from the generator. Accuracy is computed against truth;
  model self-report is never trusted.

## Metrics and display

- Per lane, live: decisions completed, accuracy, average latency, total time,
  cost per decision, total cost.
- Decision feed panel per lane: item thumbnail, model answer, truth, latency.
  Wrong rows highlighted.
- Charts: latency histogram and accuracy-over-time, both models overlaid.

## Error handling

- Adapter timeout or error: the decision is logged as `error`, the item goes to
  the mistakes tray, and the lane continues. No silent retries unless enabled
  in config.
- One lane failing never stops the other lane.

## Scale

Small rounds only: roughly 10–200 items per game, every item a real model call.
No extrapolation or simulated decisions.

## Testing

- Sprite generator: same seed produces identical images (determinism test).
- Adapters: contract tests against mock servers (OpenAI-compatible mock, Jev
  HTTP mock).
- Orchestrator: scoring, error path, lane independence.
- Manual playtest with one real local model.

## Out of scope

- Photo datasets, distractor item classes, sequential (non-race) modes,
  leaderboards, sound, mobile layout.

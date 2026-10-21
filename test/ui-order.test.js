import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEvents, runScopedEvents } from '../public/app.js';

test('out-of-order events are sorted per lane by sequence (Review Focus 4)', () => {
  const events = [
    { laneId: 'a', seq: 2 }, { laneId: 'a', seq: 1 }, { laneId: 'b', seq: 1 }, { laneId: 'a', seq: 3 },
  ];
  const byLane = orderEvents(events);
  assert.deepEqual(byLane.a.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(byLane.b.map((e) => e.seq), [1]);
});
test('events from a previous run are not rendered into the new run', () => {
  const events = [
    { runId: 'old', laneId: 'a', seq: 1 }, { runId: 'new', laneId: 'a', seq: 2 },
    { runId: 'new', laneId: 'a', seq: 1 },
  ];
  const scoped = runScopedEvents(events, 'new');
  assert.ok(scoped.every((e) => e.runId === 'new'));
  assert.deepEqual(orderEvents(scoped).a.map((e) => e.seq), [1, 2]);
});

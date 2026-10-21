import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEvents } from '../public/app.js';

test('out-of-order events are sorted per lane by sequence (Review Focus 4)', () => {
  const events = [
    { laneId: 'a', seq: 2 }, { laneId: 'a', seq: 1 }, { laneId: 'b', seq: 1 }, { laneId: 'a', seq: 3 },
  ];
  const byLane = orderEvents(events);
  assert.deepEqual(byLane.a.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(byLane.b.map((e) => e.seq), [1]);
});

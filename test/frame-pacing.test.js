import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramePacingMonitor } from 'roamwright/runtime/frame-pacing.js';

test('reports one sustained episode and rearms on recovery or reset', () => {
  const reports = [];
  const monitor = createFramePacingMonitor({ minimumFps: 50, onSlow: (...args) => reports.push(args) });
  const feed = (n, ms) => { for (let i = 0; i < n; i++) monitor.sample(ms); };
  feed(80, 25);
  feed(50, 20); // exactly the floor ends an episode
  feed(80, 25);
  monitor.reset();
  feed(119, 25);
  assert.deepEqual(reports, []);
  feed(81, 25);
  assert.deepEqual(reports, [[40, 3000]]);
  feed(50, 20);
  feed(120, 25);
  assert.deepEqual(reports, [[40, 3000], [40, 3000]]);
});
test('weights unequal windows by elapsed time and ignores invalid samples', () => {
  const reports = [];
  const m = createFramePacingMonitor({ minimumFps: 60, windowMs: 60, windows: 2, onSlow: (...args) => reports.push(args) });
  for (const ms of [NaN, Infinity, -1, 0, 20, 20, 20, 80]) m.sample(ms);
  assert.deepEqual(reports, [[4 * 1000 / 140, 140]]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { followRoutine, walkRound } from 'roamwright/motion/crowd-routine.js';

test('a retraced route visits both ends, holds at its stops, and wraps', () => {
  const points = [{ x: 0, z: 0, w: 2 }, { x: 3, z: 0 }, { x: 3, z: 4, w: 3, role: 'rest', yaw: 1 }];
  const g = walkRound(points, 1, { retrace: true });
  assert.deepEqual(g.legs.map(l => [l.x0, l.z0, l.t0]), [[0, 0, 0], [3, 0, 3], [3, 4, 10], [3, 0, 14]]);
  assert.deepEqual([g.T, g.distance], [19, 14]);
  for (const offset of [0, 19, 19000]) {
    const at = {};
    followRoutine(g, offset + 8, at);
    assert.deepEqual([at.x, at.z, at.focus, at.yaw, at.speed], [3, 4, 'rest', 1, 0]);
    followRoutine(g, offset + 12, at);
    assert.deepEqual([at.x, at.z, at.speed], [3, 2, 1]);
  }
});

test('an obstructed segment or endpoint rejects the entire trip without consuming the seed', () => {
  const points = [{ x: 1, z: 1 }, { x: 1, z: 6 }];
  for (const obstacle of [1, 3.5, 6]) {
    assert.equal(walkRound(points, 1, { clearAt: (x, z) => z !== obstacle, rng: assert.fail }), null);
  }
  const route = walkRound(points, 1, { rng: () => 0.25, size: 2, spread: 4 });
  assert.deepEqual([route.ph, route.s], [2.5, 3]);
  assert.equal(walkRound([points[0]], 1).legs, null);
});

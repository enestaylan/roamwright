import assert from 'node:assert/strict';
import test from 'node:test';
import { circleClearances } from 'roamwright/math/circle-clearances.js';

test('keeps the requested gap to each nearest neighbour in input order', () => {
  const points = [{ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 3, z: 14 }];
  assert.deepEqual([...circleClearances(points, 0.1)], [2.25, 2.25, 4.5]);
  assert.deepEqual([...circleClearances(points.toReversed())], [5, 2.5, 2.5]);
});

test('handles empty, isolated and coincident centres', () => {
  const p = { x: -10, z: 15 };
  assert.equal(circleClearances([]).length, 0);
  assert.equal(circleClearances([p])[0], Infinity);
  assert.deepEqual([...circleClearances([p, p])], [0, 0]);
  assert.throws(() => circleClearances([p], 1), RangeError);
});

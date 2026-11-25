import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestPathPoint, pathBox, stampPath } from 'roamwright/geometry/path-field.js';
import { polyGrid, gridField, polyField } from 'roamwright/geometry/outline-grid.js';

test('bounded path sampling reports segment fraction and side without overwriting a miss', () => {
  const line = [
      [0, 0],
      [2, 0],
      [2, 8],
    ],
    path = { line, box: pathBox(line) },
    hit = {};
  assert.equal(nearestPathPoint(path, 1, 0.5, 1, hit), true);
  assert.deepEqual(hit, { d: 0.5, t: 0.25, side: 1 });
  assert.equal(nearestPathPoint(path, 1, -1, 1, hit), false);
  assert.deepEqual(hit, { d: 0.5, t: 0.25, side: 1 });
  assert.equal(nearestPathPoint(path, 3, 4, 2, hit), true);
  assert.deepEqual(hit, { d: 1, t: 0.75, side: -1 });
});
test('an outline distance grid survives transfer and reversal', () => {
  const square = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const grid = polyGrid(square, 0.5, 1);
  const sample = gridField(structuredClone(grid, { transfer: [grid.g.buffer] }));
  const reversed = polyField(square.reverse(), 0.5, 1);
  for (const [x, z, d] of [
    [2, 2, -2],
    [4, 2, 0],
    [4.5, 2, 0.5],
    [8, 2, 4],
  ]) {
    assert.ok(Math.abs(sample(x, z) - d) < 1e-10);
    assert.ok(Math.abs(reversed(x, z) - d) < 1e-10);
  }
});
test('path samples stamp the closest value into a rectangular translated grid', () => {
  const field = { x0: -2, z0: 1, width: 5, height: 3, spacing: 1 };
  const distances = new Float32Array(15).fill(100),
    values = new Float32Array(15);
  stampPath(
    field,
    [
      [-1, 1],
      [1, 3],
    ],
    1,
    distances,
    values,
    t => 10 + t,
  );
  assert.equal(distances[1], 0);
  assert.equal(values[1], 10);
  assert.equal(distances[13], 0);
  assert.equal(values[13], 11);
  assert.equal(distances[0], 1);
  assert.equal(distances[4], 100);
});

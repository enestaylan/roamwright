import assert from 'node:assert/strict';
import test from 'node:test';
import { createScatterGrid } from 'roamwright/geometry/scatter-grid.js';

test('scatter levels refill independently and use the same world cells after returning', () => {
  const snapshots = [];
  const filled = [];
  const points = [[], []];
  const update = createScatterGrid({
    rings: [{ cell: 1, half: 3, refill: 1 }, { cell: 2, half: 4, refill: 3 }],
    hash: (_x, _z, seed) => seed * 0.25,
    seeds: [1, 2],
    start(level) { filled.push(level); points[level].length = 0; },
    fill(level, index, x, z, _a, _b, ix, iz) {
      if ((ix + iz) % 2) return false;
      points[level][index] = [x, z];
      return true;
    },
    finish(grids) { snapshots.push(grids.map(g => [g.count, g.inner, g.outer])); },
  });
  assert.equal(update(0, 0), true);
  assert.deepEqual(snapshots.at(-1), [[18, 0, 2], [32, 2, 5]]);
  const original = structuredClone(points);
  assert.equal(update(0.3, 0.2), false);
  update(1.1, 0);
  assert.deepEqual(filled, [0, 1, 0]);
  update(0, 0);
  assert.deepEqual(points, original);
  update(0, 0, 0);
  assert.deepEqual(snapshots.at(-1), [[0, 0, 0], [0, 0, 0]]);
});

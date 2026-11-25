import assert from 'node:assert/strict';
import test from 'node:test';
import { createStrataField } from '../geometry/strata-field.js';
import { createStrataTiles } from '../geometry/strata-tiles.js';

test('rock heights, colour and geomorph targets survive a worker hand-off', () => {
  const cells = 8, spacing = 4, size = cells * spacing;
  const count = (cells + 1) ** 2, heights = new Float32Array(count);
  const normals = new Float32Array(count * 3), colours = new Uint8Array(count * 3).fill(128);
  for (let k = 0; k < count; k++) {
    heights[k] = (k % (cells + 1)) * spacing * 2;
    normals.set([-2 / Math.sqrt(5), 1 / Math.sqrt(5), 0], k * 3);
  }
  const source = createStrataField({ seed: 904, cells, spacing });
  source.planCliffShape({ heights, colours, normals, exposure: () => 2 });
  const receiver = createStrataField({ seed: 904, cells, spacing });
  assert.equal(receiver.cliffMask(0, 0), 0);
  receiver.takeCliffShape(source.cliffShapePlan(), { heights, colours });
  const a = createStrataTiles({ size, ...source }), b = createStrataTiles({ size, ...receiver });
  a.planRegion(); b.takeRegion(a.regionPlan()); b.takeRegion(a.regionPlan());
  assert.equal(b.tiles.length, a.tiles.length);
  for (let lv = 0; lv < 3; lv++) {
    const key = a.boxKey(a.tiles[0], lv), built = a.boxNow(lv, key);
    assert.deepEqual(b.boxNow(lv, key), built);
    assert.ok(built.attributes.position[0].every(Number.isFinite));
    assert.ok(built.index.length > 0);
    assert.ok(built.attributes.normal[0].every(Number.isFinite));
  }
});

test('fine beds do not turn into alternating vertex colours on a sheer face', () => {
  const cells = 8, stride = cells + 1;
  const heights = new Float32Array(stride ** 2), normals = new Float32Array(stride ** 2 * 3);
  for (let k = 0; k < heights.length; k++) {
    heights[k] = (k % stride) * 24;
    // The surrounding terrain smoothed this local wall into a modest incline.
    normals.set([-0.6, 0.8, 0], k * 3);
  }
  const field = createStrataField({ cells, spacing: 1, seed: 17 });
  field.planCliffShape({ heights, normals, colours: new Uint8Array(normals.length), exposure: () => 2 });
  for (let x = -2; x <= 2; x += 0.5) {
    const point = field.cliffPoint(x, 0, 0, { p: [0, 0, 0] });
    assert.equal(point.bed, 0.5);
    assert.equal(point.hard, 0.6);
  }
});

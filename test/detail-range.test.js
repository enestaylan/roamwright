import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { detailLens, withinDetailRange, detailLevel } from 'roamwright/rendering/detail-range.js';
import { detailLevel as crowdLevel } from 'roamwright/motion/crowd-routine.js';

test('perspective detail follows vertical FOV and optical zoom', () => {
  const camera = new PerspectiveCamera();
  for (const base of [50, 66, 76, 90]) {
    camera.fov = base;
    camera.zoom = 1;
    assert.equal(detailLens(camera, base), 1);
    assert.equal(withinDetailRange(30 ** 2, false, detailLens(camera, base), [19, 21]), false);
    camera.zoom = 2;
    assert.equal(detailLens(camera, base), 2);
    camera.zoom = 1;
    camera.fov = 2 * Math.atan(Math.tan(base * Math.PI / 360) / 2) * 180 / Math.PI;
    assert.ok(Math.abs(detailLens(camera, base) - 2) < 1e-12);
    assert.ok(withinDetailRange(30 ** 2, false, detailLens(camera, base), [19, 21]));
  }
});

test('first sight uses the midpoint and reversals retain the same mesh through the band', () => {
  const pick = (d, last) => withinDetailRange(d * d, last, 1, [9, 11]);
  assert.equal(pick(10), false);
  assert.equal(pick(9.99), true);
  let last;
  const results = [12, 10, 9, 8.99, 10, 10.99, 10, 11, 10].map(d => last = pick(d, last));
  assert.deepEqual(results, [false, false, false, true, true, true, true, false, false]);
  assert.equal(crowdLevel, detailLevel);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D, PerspectiveCamera } from 'three';
import { createLabelRange } from 'roamwright/rendering/label-range.js';

test('world labels fade within the reading distance, including a shorter subject limit', () => {
  const range = createLabelRange(2, 6);
  assert.equal(range.opacity(2), 1);
  assert.equal(range.opacity(4), 0.5);
  assert.equal(range.opacity(6), 0);
  assert.equal(range.opacity(100), 0);
  assert.equal(range.opacity(2, 3), 0.5);
  assert.equal(range.opacity(0, 0), 0);
  assert.throws(() => createLabelRange(2, 2), RangeError);
});

test('groups select nearby visible anchors using world distance and forget missing members each frame', () => {
  const parent = new Object3D();
  parent.position.set(17, 11, -8);
  const camera = new PerspectiveCamera(75, 1, 0.1, 100);
  parent.add(camera);
  parent.updateMatrixWorld();
  const range = createLabelRange(2, 6);
  const group = range.selection(), other = range.selection();
  assert.equal(group.distance(1), Infinity);
  assert.equal(group.accept(1, camera, 17, 11, -14), false);
  assert.equal(group.accept(1, camera, 17, 11, -4), false);
  assert.equal(group.accept(1, camera, 17, 11, -12), true);
  assert.equal(group.accept(1, camera, 17, 11, -11, 20), false);
  assert.equal(group.accept(1, camera, 17, 11, -11), true);
  assert.equal(group.accept(1, camera, 17, 11, -11), false);
  assert.equal(group.distance(1), 3);
  assert.equal(group.distance(2), Infinity);
  assert.equal(other.distance(1), Infinity);
  assert.equal(group.accept(2, camera, 17, 11, -13), true);
  assert.equal(group.distance(2), 5);
});

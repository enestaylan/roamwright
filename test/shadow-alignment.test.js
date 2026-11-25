import assert from 'node:assert/strict';
import test from 'node:test';
import { OrthographicCamera, Vector3 } from 'three';
import { createShadowSnap, fitOrthographicShadow } from '../rendering/shadow-alignment.js';

test('shadow center aligns with rectangular texels at the original light depth', () => {
  const snap = createShadowSnap();
  const point = new Vector3(6.7, -6.1, 4.4);
  const out = new Vector3();
  const direction = new Vector3(0.3, 0.8, 0.6).normalize();
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right);
  assert.equal(snap(out, point.x, point.y, point.z, direction, 0.4, 0.9), out);
  assert.ok(Math.abs(out.dot(direction) - point.dot(direction)) < 1e-12);
  assert.ok(Math.abs(out.dot(right) / 0.4 - Math.round(point.dot(right) / 0.4)) < 1e-12);
  assert.ok(Math.abs(out.dot(up) / 0.9 - Math.round(point.dot(up) / 0.9)) < 1e-12);
  snap(out, 0.2, 3, 1.3, new Vector3(0, 1, 0), 1);
  assert.deepEqual(out.toArray(), [0, 3, 1]);
});

test('the orthographic fit updates the projection matrix', () => {
  const camera = new OrthographicCamera();
  fitOrthographicShadow(camera, 10, 5, 75);
  assert.equal(camera.far, 75);
  assert.equal(camera.near, 5);
  assert.equal(camera.left, -10);
  const edge = new Vector3(10, 10, -5).applyMatrix4(camera.projectionMatrix);
  assert.ok(edge.distanceTo(new Vector3(1, 1, -1)) < 1e-12);
});

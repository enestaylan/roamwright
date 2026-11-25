import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, PlaneGeometry } from 'three';
import { createCameraGuard } from '../examples/viaduct-camera.js';

test('low orbits clear sloping terrain, canopy edges, and the river at the grid boundary', () => {
  const ground = new PlaneGeometry(20, 20, 10, 10).rotateX(-Math.PI / 2);
  const vertices = ground.attributes.position;
  for (let i = 0; i < vertices.count; i++) vertices.setY(i, vertices.getX(i) * 1.5);
  const guard = createCameraGuard(ground, [{ x: -4, z: 2, top: 12, radius: 2 }]);
  const camera = new PerspectiveCamera(65, 3, 0.25, 100);
  const halfHeight = camera.near * Math.tan(camera.fov * Math.PI / 360);
  const margin = Math.hypot(camera.near, halfHeight, halfHeight * camera.aspect);

  for (const side of [-1, 1]) {
    camera.position.set(-4 + side * 2, -5, 2);
    guard(camera);
    assert.ok(camera.position.y - margin > 12);
  }
  camera.position.set(7.8, 0, -4);
  guard(camera);
  assert.ok(camera.position.y - margin > 1.5 * (7.8 + margin));
  camera.position.set(-50, -20, 50);
  guard(camera);
  assert.ok(camera.position.x >= -10 + margin && camera.position.z <= 10 - margin);
  assert.ok(camera.position.y > margin);

  camera.position.set(2, 40, 1);
  guard(camera);
  assert.deepEqual(camera.position.toArray(), [2, 40, 1]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Matrix4, Scene, Vector3 } from 'three';
import { createNoise, createUnitShapes, GeometryBuilder, geometryOf, mulberry32 } from '../index.js';
import { sphereOf } from '../geometry/builder.js';
import { trackWorldMatrices } from '../rendering/world-matrices.js';

test('seeded streams resume at the same sample and tile across texture seams', () => {
  const a = mulberry32(321);
  a();
  const b = mulberry32(a.state());
  assert.equal(a(), b());
  const first = createNoise(123);
  const same = createNoise(123);
  const other = createNoise(456);
  assert.equal(first.fbm(-3.25, 8, 4, 7), same.fbm(-3.25, 8, 4, 7));
  assert.notEqual(first.fbm(-3.25, 8, 4, 7), other.fbm(-3.25, 8, 4, 7));
  assert.equal(first.tnoise(-0.25, 3, 16, 9), first.tnoise(15.75, 3, 16, 9));
});

test('packed buffers reconstruct the triangle bounds and normalized colors', () => {
  const g = new GeometryBuilder();
  g.box(2, 0, -1, 4, 2, 2, [0.5, 1, 0]);
  const buffers = g.parts(true, true);
  const bounds = sphereOf(buffers.position);
  const mesh = geometryOf(buffers, bounds);
  assert.equal(mesh.getAttribute('position').count, 36);
  assert.equal(mesh.getAttribute('color').normalized, true);
  assert.equal(mesh.getAttribute('color').itemSize, 4);
  assert.deepEqual(bounds.slice(0, 3), [2, 1, -1]);
  assert.equal(mesh.boundingSphere.radius, Math.sqrt(6));
  const shapes = createUnitShapes();
  assert.ok(shapes.box instanceof BoxGeometry);
  assert.ok(shapes.rock.attributes.normal.count > 0);
});

test('tracked world matrices follow movement and reparenting', async () => {
  const { Object3D } = await import('three');
  const scene = new Scene(), a = new Object3D(), b = new Object3D(), child = new Object3D();
  scene.add(a, b);
  a.position.x = 4;
  b.position.y = 12;
  child.position.z = 3;
  a.add(child);
  const place = trackWorldMatrices(scene);
  place();
  assert.deepEqual(new Vector3().setFromMatrixPosition(child.matrixWorld).toArray(), [4, 0, 3]);
  b.add(child);
  place();
  assert.deepEqual(child.matrixWorld.elements, new Matrix4().makeTranslation(0, 12, 3).elements);
});

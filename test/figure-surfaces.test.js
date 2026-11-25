import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { headFn } from 'roamwright/geometry/head-shape.js';
import { faceAt, faceGrid, faceSculpt } from 'roamwright/geometry/face-grid.js';
import { buildEar } from 'roamwright/geometry/ear.js';
import { GeometryBuilder } from 'roamwright';
import { KIND, garmentTag } from 'roamwright/geometry/garment-tags.js';
import { createClothTextures } from 'roamwright/math/cloth-textures.js';

test('sampled face grids join sparse back rows and keep feature channels', () => {
  const grid = faceGrid([-110, -70, -20, 0, 20, 78, 108], [0, 15, 40, 65], [90, 135, 180], [-70, 20, 78]);
  const neutral = headFn(), broad = headFn({ jaw: 1, nose: 1.6 });
  const face = faceSculpt(neutral, grid);
  const other = faceSculpt(broad, grid);
  assert.notDeepEqual(face.P, other.P);
  assert.equal(face.CH.length, face.P.length / 3 * 8);
  assert.ok(face.P.every(Number.isFinite) && face.N.every(Number.isFinite));
  for (const i of face.idx) assert.ok(i >= 0 && i < face.P.length / 3);
  for (let i = 0; i < grid.nr; i++) {
    const first = i * grid.nc * 3, last = first + (grid.nc - 1) * 3;
    assert.deepEqual(face.N.slice(first, first + 3), face.N.slice(last, last + 3));
  }
  const point = new Vector3();
  neutral.skull(new Vector3(0, 0, 1), point);
  assert.ok(Math.abs(neutral.reach(point.x, point.y, point.z) - 1) < 1e-6);
  const [x, y, z, nx, ny, nz] = faceAt(neutral, 0.015, 0);
  assert.ok(x > 0 && Math.abs(y) < 0.01 && z > 0 && Math.abs(Math.hypot(nx,ny,nz) - 1) < 1e-6);
});

test('both ears return into the sampled skull on different heads', () => {
  const center = 1.6;
  for (const head of [headFn(), headFn({ jaw: 1, cheek: 1.8, chinW: 1.35 })]) {
    for (const side of [-1, 1]) {
      const ear = new GeometryBuilder();
      buildEar(ear, head, side, center, [0.4, 0.25, 0.18], 1);
      const { position, normal } = ear.parts();
      const rear = position.slice(-28 * 9);
      assert.equal(position.length / 9, 182);
      assert.ok(normal.every(Number.isFinite));
      for (let i = 0; i < rear.length; i += 9) {
        const reaches = [0, 3, 6].map(j => head.reach(rear[i + j], rear[i + j + 1] - center, rear[i + j + 2]));
        assert.ok(reaches.some(reach => reach < 0.92), 'Each return triangle touches the buried attachment');
      }
    }
  }
});

test('seeded garment fields supply weave, fold slopes and crease slopes', () => {
  const bytes = (seed, name) => {
    const fill = createClothTextures({ seed })[name](), data = new Uint8ClampedArray(24 * 24 * 3), pixel = [0,0,0];
    for (let i = 0; i < 24 * 24; i++) {
      fill((i % 24) / 24, Math.floor(i / 24) / 24, pixel);
      data.set(pixel, i * 3);
    }
    return data;
  };
  for (const name of ['weave','folds','crumple']) {
    const field = bytes(17, name);
    assert.ok(new Set(field).size > 10);
    assert.deepEqual(field, bytes(17, name));
    assert.notDeepEqual(field, bytes(18, name));
  }
  assert.equal(garmentTag(-1, KIND.plate), -5.1);
  assert.ok(Math.abs(garmentTag(1, KIND.linen) + 1.9) < 1e-12);
});

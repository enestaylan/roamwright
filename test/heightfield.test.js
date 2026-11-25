import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaneGeometry, Raycaster, Vector3, Mesh } from 'three';
import { heightfieldSampler, refineHeightfield } from 'roamwright/geometry/heightfield.js';

function grid(x, z, width, depth, columns, rows, height) {
  const geo = new PlaneGeometry(width, depth, columns, rows).rotateX(-Math.PI / 2).translate(x, 0, z);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  return geo;
}
const surface = (x, z) => Math.sin(x) - Math.cos(z) * 2;
const ray = new Raycaster();
const down = new Vector3(0, -1, 0);
function rayHeight(meshes, x, z) {
  ray.set(new Vector3(x, 100, z), down);
  return ray.intersectObjects(meshes)[0].point.y;
}
test('sample both triangles and the perimeter of a rectangular heightfield', () => {
  const geo = grid(5, -1, 8, 9, 4, 3, surface);
  const sample = heightfieldSampler(geo, () => -100);
  for (const [x, z] of [[1, -5.5], [9, 3.5], [1.25, -5], [2.8, -3], [4, 0]]) {
    assert.ok(Math.abs(sample(x, z) - rayHeight([new Mesh(geo)], x, z)) < 1e-8);
  }
  assert.equal(sample(0, 7), -100);
});
test('a finer patch meets the rendered edges and replaces only its coarse triangles', () => {
  const base = grid(0, 0, 12, 18, 6, 6, surface);
  const coarse = heightfieldSampler(base);
  const meshes = [new Mesh(base)];
  const initial = base.index.array.slice();
  const sample = refineHeightfield(base, { x: 0.2, z: -0.3, cells: 2, subdivisions: 4, height: surface,
    createPatch({ x, z, width, depth, segments, height }) {
      const patch = grid(x, z, width, depth, segments, segments, height);
      meshes.push(new Mesh(patch));
      return patch;
    },
  });
  for (let z = -8.99; z < 9; z += 0.43) for (let x = -5.99; x < 6; x += 0.38) {
    assert.ok(Math.abs(sample(x, z) - rayHeight(meshes, x, z)) < 1e-7);
  }
  for (let t = -1; t <= 1; t += 0.125) {
    assert.ok(Math.abs(sample(2, t * 3) - coarse(2, t * 3)) < 2e-7);
    assert.ok(Math.abs(sample(t * 2, -3) - coarse(t * 2, -3)) < 2e-7);
  }
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const k = (r * 6 + c) * 6;
    const removed = r >= 2 && r < 4 && c >= 2 && c < 4;
    assert.deepEqual([...base.index.array.slice(k, k + 6)], removed ? [0,0,0,0,0,0] : [...initial.slice(k, k + 6)]);
  }
  assert.equal(sample(54, 21), surface(54, 21));
  assert.throws(() => refineHeightfield(base, { x: 20, z: 0, cells: 2, subdivisions: 4 }), RangeError);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { createSaggingTube } from 'roamwright/geometry/sagging-tube.js';
test('tube joins spans with one ring, follows moved ends and retains its arrays', () => {
  const segments = 4,
    sides = 4,
    rings = segments * 2 + 1;
  const pos = new Float32Array(rings * sides * 3),
    nor = pos.slice();
  const update = createSaggingTube({ spanSegments: segments, radialSegments: sides, radius: 0.1, slack: 1.2, extraLength: 0.2 });
  const points = [
    [0, 0, 0],
    [3, 0, 0],
    [6, 1, 0],
  ].map(v => new Vector3(...v));
  const center = r => {
    const c = new Vector3();
    for (let k = 0; k < sides; k++) c.add(new Vector3().fromArray(pos, (r * sides + k) * 3));
    return c.divideScalar(sides);
  };
  update(points, 3, pos, nor);
  assert.ok(center(segments).distanceTo(points[1]) < 1e-5);
  assert.ok(center(segments / 2).y < -0.1);
  points[2].y = 3;
  update(points, 3, pos, nor);
  assert.ok(center(segments * 2).distanceTo(points[2]) < 1e-5);
  for (let i = 0; i < nor.length; i += 3) assert.ok(Math.abs(Math.hypot(nor[i], nor[i + 1], nor[i + 2]) - 1) < 1e-5);
});

test('coincident anchors keep the zero-length span finite and centered', () => {
  const pos = new Float32Array(18),
    nor = pos.slice();
  const point = new Vector3(2, 3, 4);
  createSaggingTube({ spanSegments: 1, radialSegments: 3, radius: 0.1 })([point, point], 2, pos, nor);
  assert.ok(nor.every(Number.isFinite));
  const center = new Vector3();
  for (let i = 0; i < 3; i++) center.add(new Vector3().fromArray(pos, 3 * i));
  assert.ok(center.divideScalar(3).distanceTo(point) < 1e-6);
});

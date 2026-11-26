import test from 'node:test';
import assert from 'node:assert/strict';
import { softenFieldCoverage, extendFieldBorders } from 'roamwright/geometry/field-map.js';
import { fieldSurfaceGLSL } from 'roamwright/rendering/field-surface.js';
import { segmentDistance, ringContains } from 'roamwright/geometry/path-field.js';
import { wrapRadians } from 'roamwright/math/periodic.js';

test('soften the mask from its original coverage and pad the nearest field attributes by one texel', () => {
  const width = 7, height = 5;
  const map = new Uint8Array(width * height * 4);
  const attributes = new Uint8Array(map.length);
  const at = (x, y) => (y * width + x) * 4;
  for (const [x, value] of [[2, 80], [4, 150]]) {
    const i = at(x, 2);
    map.set([value, 42, 9, 255], i);
    attributes.set([value, 2, 3, 4], i);
  }
  softenFieldCoverage(map, width, height);
  assert.equal(map[at(2, 2) + 3], 28);
  assert.equal(map[at(4, 2) + 3], 28);
  extendFieldBorders(map, attributes, width, height);
  assert.deepEqual([...map.slice(at(3, 2), at(3, 2) + 4)], [80, 42, 0, 0]);
  assert.deepEqual([...attributes.slice(at(3, 2), at(3, 2) + 4)], [80, 2, 3, 4]);
  assert.equal(map[at(1, 1)], 0);
  assert.equal(map[at(0, 2)], 0);
});

test('field surfaces take a procedural parcel sampler, RGB palette and optional crop branches', () => {
  const palette = ['vec3(0.2)', 'vec3(0.6)'];
  const look = { read: 'vec4 lot = parcel; vec2 plan = positionXZ;', baked: 'groundTint',
    dirt: palette, straw: palette, standing: palette, pasture: palette };
  const extension = ' else if (kind == 7.0) { crop = vec3(0.3); }';
  assert.ok(fieldSurfaceGLSL(look).includes(look.read));
  assert.ok(fieldSurfaceGLSL({...look, kinds: extension}).includes(extension));
  assert.ok(!fieldSurfaceGLSL(look).includes('undefined'));
});

test('signed angle wrapping preserves negative zero and opposite headings', () => {
  for (const angle of [Math.PI, -Math.PI, -0, 0]) assert.equal(wrapRadians(angle), angle);
  assert.ok(Math.abs(wrapRadians(4 * Math.PI + 0.25) - 0.25) < 1e-14);
});

test('parcel edges clamp to endpoints and polygon scans preserve a half-open raster boundary', () => {
  assert.equal(segmentDistance(1, 5, [1, 2], [1, 2]), 3);
  assert.equal(segmentDistance(4, 2, [1, 0], [1, 3]), 3);
  assert.equal(segmentDistance(4, 7, [1, 0], [1, 3]), 5);
  const ring = [[0,0], [2,0], [2,2], [0,2]];
  for (const points of [ring, ring.toReversed()]) {
    assert.equal(ringContains(points, 0, 0), true);
    assert.equal(ringContains(points, 2, 1), false);
    assert.equal(ringContains(points, 1, 2), false);
    assert.equal(ringContains(points, 1, 1), true);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { GeometryBuilder } from 'roamwright';
import { sweepTube } from 'roamwright/geometry/swept-tube.js';
import { mulberry32 } from 'roamwright/math/random.js';
import { wanderingPath } from 'roamwright/math/wandering-path.js';

test('the sweep samples rings by distance before height adjustment and retains triangle winding', () => {
  for (const clockwise of [false, true]) {
    const builder = new GeometryBuilder(), fractions = [];
    builder.ox = 11;
    builder.oy = 2;
    builder.oz = -7;
    sweepTube(builder, [[0, 0, 0], [0, 1, 0], [0, 4, 0]], {
      sides: 4, clockwise, color: [1, 0.5, 0.25],
      radius: f => { fractions.push(f); return 2 - f; },
      shade: f => 1 - f,
      centerY: ([, y]) => y + 3,
    });
    const { position, normal, color } = builder.parts(false);
    assert.deepEqual(fractions, [0, 0.25, 1]);
    assert.equal(position.length, 2 * 4 * 6 * 3);
    const a = new Vector3().fromArray(position), b = new Vector3().fromArray(position, 3), c = new Vector3().fromArray(position, 6);
    assert.ok(a.distanceTo(new Vector3(13, 5, -7)) < 1e-6);
    assert.equal(Math.sign(b.sub(a).cross(c.sub(a)).dot(new Vector3().fromArray(normal))), clockwise ? -1 : 1);
    assert.deepEqual(Array.from(color.slice(0, 6)), [1, 0.5, 0.25, 0.75, 0.375, 0.1875]);
    assert.deepEqual(Array.from(color.slice(-6, -3)), [0, 0, 0]);
  }
});

test('repeated points yield finite unit normals and short paths add no triangles', () => {
  const builder = new GeometryBuilder(), options = { sides: 3, color: [1, 1, 1], radius: 1 };
  sweepTube(builder, [], options);
  sweepTube(builder, [[1, 2, 3]], options);
  assert.equal(builder.count, 0);
  sweepTube(builder, [[0, 1, 0], [0, 1, 0], [0, 0, 2], [1, -2, 3]], options);
  const { normal } = builder.parts(false);
  for (let i = 0; i < normal.length; i += 3) assert.ok(Math.abs(Math.hypot(normal[i], normal[i + 1], normal[i + 2]) - 1) < 1e-6);
  assert.throws(() => sweepTube(builder, [], { ...options, sides: 0 }), RangeError);
});

test('a seeded wandering path takes full steps and consumes three draws per step', () => {
  const start = [2, 3, 4], heading = [0, 1, 0];
  const draw = mulberry32(17), ref = mulberry32(17);
  const opts = { step: 0.75, curl: 0.3, verticalScale: 0.5, persistence: 0.4, pull: [0.05, 0, 0] };
  const path = wanderingPath(draw, start, heading, 2, opts);
  assert.deepEqual(path, wanderingPath(mulberry32(17), start, heading, 2, opts));
  assert.notEqual(path[0], start);
  assert.deepEqual(path[0], start);
  assert.equal(path.length, 4);
  for (let i = 1; i < path.length; i++) {
    const distance = new Vector3(...path[i]).distanceTo(new Vector3(...path[i - 1]));
    assert.ok(Math.abs(distance - opts.step) < 1e-12);
    ref(); ref(); ref();
  }
  assert.equal(draw(), ref());
  assert.throws(() => wanderingPath(draw, start, heading, 2, { ...opts, step: 0 }), RangeError);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { GB } from '../geometry/builder.js';
import { createSculptor, triangle } from '../geometry/sculpt.js';

const color = [0.6, 0.45, 0.3];
const rings = [
  [0, 1, 1, 0, 0, color, 1, 2, 0.75],
  [0.5, 1.2, 1, 0, 0, color, 1, 2, 0.5],
  [1, 0.8, 1, 0.1, 0, color, 1, 2, 0.25],
];
rings[1].fine = true;

test('indexed relief and its triangle stream describe identical shaded, weighted vertices', () => {
  const model = createSculptor({ vertexTag: (_builder, ring) => ring[0] - 3 });
  for (const lod of [0, 1, 2]) {
    model.setLodLo(lod);
    for (const a1 of [Math.PI, 2 * Math.PI]) {
      const build = joined => {
        const gb = new GB();
        gb.tg = []; gb.sk = []; gb.sk2 = []; gb.skw = [];
        gb.tv = 6;
        model.loft(gb, 1, 2, 3, rings, 12, {
          joined, a1, relief: (y, a) => 0.05 * Math.cos(3*a+y),
          tint: (_p, a) => 0.9 + 0.1 * Math.cos(a),
        });
        assert.equal(gb.tv, 6);
        return gb.parts();
      };
      const indexed = build(true), flat = build(false);
      assert.equal(indexed.index.length, (lod ? 1 : 2) * [12,6,5][lod] * 6);
      for (const [name, size] of Object.entries({position:3, normal:3, color:3, skinIndex:4, skinWeight:4, aTag:1})) {
        for (const [i, vertex] of indexed.index.entries()) {
          assert.deepEqual(indexed[name].subarray(vertex*size,(vertex+1)*size), flat[name].subarray(i*size,(i+1)*size));
        }
      }
    }
  }
});

test('sculpt caching is isolated by factory and detail level', () => {
  const first = createSculptor(), second = createSculptor();
  const shape = (dir, out, channels) => { out.copy(dir); channels[0] = dir.y; channels[1] = 1; };
  const high = first.sculptMesh('__proto__', 8, shape);
  assert.equal(first.sculptMesh('__proto__', 8, shape), high);
  for (let i = 0; i < high.n; i++) {
    assert.ok(Math.abs(Math.hypot(...high.N.subarray(i*3,i*3+3)) - 1) < 1e-5);
    assert.equal(high.A[i], high.D[i*3+1]);
  }
  first.setLodLo(1);
  const low = first.sculptMesh('__proto__', 8, shape);
  first.setLodLo(2);
  assert.ok(first.sculptMesh('__proto__', 8, shape).n < low.n && low.n < high.n);
  assert.equal(second.sculptMesh('__proto__', 8, shape).n, high.n);
});

test('a triangle follows its supplied normals when the input is wound backwards', () => {
  const gb = new GB();
  triangle(gb,[0,0,0,0,1,0],[1,0,0,0,1,0],[0,0,1,0,1,0],color,1);
  assert.deepEqual([...gb.p],[0,0,0,0,0,1,1,0,0]);
});

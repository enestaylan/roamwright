import assert from 'node:assert/strict';
import test from 'node:test';
import { bedCanopy, bedLinen, linenCase } from 'roamwright/geometry/bedding.js';

const linen = [0.6, 0.5, 0.4];
function vertices(build) {
  const rows = [];
  build({ raw: (...vertex) => rows.push(vertex) });
  assert.ok(rows.length > 0 && rows.length % 3 === 0);
  assert.ok(rows.every(vertex => vertex.every(Number.isFinite)));
  return rows;
}

test('canopy hangs between its supports and has an underside', () => {
  const rows = vertices(b => bedCanopy(b, 4, 3, 5, 2, 2.4, linen));
  const centre = rows.filter(([x,,z]) => x === 4 && z === 5);
  assert.ok(centre.length && centre.every(([, y]) => y < 3));
  assert.ok(centre.some(v => v[4] < -0.9) && centre.some(v => v[4] > 0.9));
  assert.ok(rows.some(([x,y,z]) => x === 3 && y === 3 && z === 5));
});

test('cushions have a hollow crown and respect the requested orientation', () => {
  const rows = vertices(b => linenCase(b, 0, 0, 0, 1.2, 0.25, 0.6, linen, Math.PI / 2));
  const max = axis => Math.max(...rows.map(v => v[axis]));
  assert.ok(max(2) > 1.9 * max(0));
  const centre = rows.filter(([x,,z]) => Math.hypot(x, z) < 0.00001);
  assert.ok(Math.max(...centre.map(v => v[1])) < max(1));
});

test('dressing a bed produces repeatable surfaces and the specified number of pillows', () => {
  const opts = { width: 2, length: 2.4, tick: 0.25, cover: 1.8, drop: 0.3, ticking: linen, coverTone: linen, linen };
  const build = pillows => vertices(b => bedLinen(b, 2, 1, 3, { ...opts, pillows }));
  const single = build(1);
  assert.deepEqual(build(1), single);
  assert.ok(build(2).length > single.length);
  assert.ok(single.some(([x,y]) => x > 3 && y < 0.75));
});

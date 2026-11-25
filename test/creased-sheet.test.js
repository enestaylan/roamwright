import assert from 'node:assert/strict';
import test from 'node:test';
import { creasedSheet } from 'roamwright/geometry/creased-sheet.js';
test('creased grids preserve face normals, winding, seam triangles and upward tint', () => {
  const rows = [
    [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 2],
    ],
    [
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 2],
    ],
  ];
  const colors = rows.map(row => row.map(() => [0.1, 0.2, 0.3]));
  function build(options) {
    const values = [];
    creasedSheet({ raw: (...v) => values.push(v) }, rows, colors, options);
    return values;
  }
  const hard = build({ crease: 1 }),
    soft = build({ crease: -1 });
  assert.equal(hard.length, 12);
  assert.deepEqual(hard[1].slice(3, 6), [0, 1, 0]);
  assert.ok(soft[1][5] < 0);
  const back = build({ inside: true, crease: 1 });
  assert.ok(back[1][4] < 0);
  const tinted = build({ tint: [1, 1, 1], slopeFrom: 0.1, slopeTo: 0.8, crease: 1 });
  assert.deepEqual(tinted[0].slice(6), [1, 1, 1]);
  assert.equal(build({ wrap: true }).length, 18);
});

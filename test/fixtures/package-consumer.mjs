import assert from 'node:assert/strict';
import { BufferGeometry } from 'three';
import { GeometryBuilder } from 'roamwright';
import { geometryOf } from 'roamwright/geometry/builder.js';
import { createScatterGrid } from 'roamwright/geometry/scatter-grid.js';
import { buildEar } from 'roamwright/geometry/ear.js';
import { headFn } from 'roamwright/geometry/head-shape.js';

const blocks = new GeometryBuilder();
blocks.box(0, 0, 0, 2, 3, 2, [0.3, 0.55, 0.44]);
const geometry = geometryOf(blocks.parts(true));
assert.ok(geometry instanceof BufferGeometry);
assert.equal(geometry.getAttribute('position').count, 36);
geometry.dispose();

const ear = new GeometryBuilder();
buildEar(ear, headFn(), 1, 1.6, [0.4, 0.25, 0.18], 1);
assert.ok(ear.parts().position.length > 0);

let accepted = 0;
const updateCover = createScatterGrid({
  rings: [{ cell: 1, half: 2, refill: 1 }],
  seeds: [1, 2],
  hash: () => 0.5,
  fill: () => true,
  finish: grids => { accepted = grids[0].count; },
});
updateCover(0, 0);
assert.equal(accepted, 16);

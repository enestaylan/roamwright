import assert from 'node:assert/strict';
import { cutBuilderCells } from 'roamwright/geometry/builder-cells.js';
import { createBuilderFrame } from 'roamwright/geometry/builder-frame.js';
import { fillRowBands } from 'roamwright/runtime/grid-rows.js';
import { BufferGeometry } from 'three';
import { GeometryBuilder } from 'roamwright';
import { geometryOf } from 'roamwright/geometry/builder.js';
import { createScatterGrid } from 'roamwright/geometry/scatter-grid.js';
import { buildEar } from 'roamwright/geometry/ear.js';
import { headFn } from 'roamwright/geometry/head-shape.js';

const blocks = new GeometryBuilder();
blocks.M = createBuilderFrame().matrix;
blocks.pb = [];
blocks.box(0, 0, 0, 2, 3, 2, [0.3, 0.55, 0.44]);
const geometry = geometryOf(blocks.parts(true));
assert.ok(geometry instanceof BufferGeometry);
assert.equal(geometry.getAttribute('position').count, 36);
geometry.dispose();
assert.equal(cutBuilderCells(blocks, 4)[0].parts.position.length, 108);
const grid = new Uint8Array(3);
await fillRowBands([grid], 3, 2, (start, end) => [new Uint8Array(end - start).fill(start + 1)]);
assert.deepEqual([...grid], [1, 1, 3]);

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

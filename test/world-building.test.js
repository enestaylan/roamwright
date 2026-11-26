import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4 } from 'three';
import { GB } from 'roamwright/geometry/builder.js';
import { box } from 'roamwright/geometry/primitives.js';
import { boxFacePlacer, createBuilderFrame } from 'roamwright/geometry/builder-frame.js';
import { cutBuilderCells } from 'roamwright/geometry/builder-cells.js';
import { bakeRowBands, cutRows, fillRowBands } from 'roamwright/runtime/grid-rows.js';

test('bands cover a partial interval in differently shaped grids regardless of completion order', async () => {
  const source = [Uint8Array.from({ length: 8 }, (_, i) => i + 1),
    Float32Array.from({ length: 24 }, (_, i) => i / 3)];
  const out = source.map(grid => new grid.constructor(grid.length));
  const ranges = [], complete = [];
  const filled = fillRowBands(out, 8, 3, (from, to) => {
    ranges.push([from, to]);
    return new Promise(resolve => complete.push(() => resolve(cutRows(source, 8, from, to))));
  }, 1, 8);
  assert.deepEqual(ranges, [[1,4], [4,7], [7,8]]);
  for (const finish of complete.reverse()) finish();
  await filled;
  for (const [i, grid] of out.entries()) {
    const stride = grid.length / 8;
    assert.deepEqual(grid.subarray(stride), source[i].subarray(stride));
    assert.ok(grid.subarray(0, stride).every(n => n === 0));
  }
  const steps = [];
  await bakeRowBands(8, 3, (a, b) => steps.push([a,b]), () => steps.push('yield'));
  assert.deepEqual(steps, [[0,3],'yield',[3,6],'yield',[6,8],'yield']);
  await fillRowBands([], 0, 3, () => assert.fail());
  await assert.rejects(bakeRowBands(3, 0, () => {}, () => {}), RangeError);
});

test('a failed band relinquishes the grids only after the other bands finish', async () => {
  const grid = new Uint8Array(2);
  let finish, returned = false;
  const failure = assert.rejects(fillRowBands([grid], 2, 1, start => {
    if (!start) throw Error('failed band');
    return new Promise(resolve => { finish = () => resolve([Uint8Array.of(9)]); });
  }), /failed band/).then(() => { returned = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false);
  finish();
  await failure;
  assert.deepEqual([...grid], [0,9]);
});

test('nested builder transforms restore one shared matrix and all four offset faces', () => {
  const frame = createBuilderFrame(), original = frame.matrix, local = new Matrix4();
  frame.push(local.makeTranslation(-9, 1, 2));
  frame.push(local.makeRotationY(Math.PI / 2));
  frame.pop();
  assert.deepEqual(frame.matrix, local.makeTranslation(-9, 1, 2));
  const points = [[7,2,14], [3,2,4], [9,2,7], [1,2,11]];
  for (let face = 0; face < 4; face++) {
    const put = boxFacePlacer(face, 3, 4, 5, 9);
    assert.deepEqual(put.point(2,2,1), points[face]);
    const builder = { add(shape, tone, placement) {
      assert.equal(shape, box);
      assert.deepEqual(placement.elements.slice(12,15), points[face]);
    } };
    put(builder, box, [1,1,1], 2,2,1, 1,2,3, 0.2,0.3);
  }
  frame.pop();
  assert.equal(frame.matrix, original);
  assert.deepEqual(frame.matrix, new Matrix4());
  assert.throws(frame.pop, RangeError);
});

test('compact cells keep bounds, cell and triangle order, tags and their own buffers', () => {
  const builder = new GB();
  builder.pb = []; builder.tg = [];
  const color = [0.2,0.5,0.8];
  for (const [x, size, tag] of [[-1,1,1], [1,0.5,2], [-2,1,3], [1,1,4]]) {
    builder.tv = tag;
    builder.box(x,0,0,size,size,size,color);
  }
  builder.startPart(); // empty trailing part
  const cells = cutBuilderCells(builder, 10, 1);
  assert.deepEqual(cells.map(cell => cell.small), [false,true,false]);
  const all = builder.parts(true);
  const indices = [[0,2],[1],[3]];
  for (const [i, {parts}] of cells.entries()) {
    for (const key of Object.keys(parts)) {
      const stride = all[key].length / 4;
      const expected = indices[i].flatMap(j => [...all[key].subarray(j*stride, (j+1)*stride)]);
      assert.deepEqual([...parts[key]], expected);
    }
  }
  assert.deepEqual(cells[0].sphere, [-1.5,0.5,0,Math.sqrt(1.5)]);
  assert.equal(cutBuilderCells(builder, 10).length, 2);
  builder.release();
  assert.equal(cells[0].parts.aTag.length, 72);
});

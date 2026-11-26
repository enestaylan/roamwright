import assert from 'node:assert/strict';
import test from 'node:test';
import { packCellMask, cellIsSet } from 'roamwright/geometry/cell-mask.js';

test('packed cells cross row and byte boundaries and transfer between threads', () => {
  const source = packCellMask(5, 3, i => [0, 7, 8, 14].includes(i));
  const mask = structuredClone(source, { transfer: [source.bits.buffer] });
  assert.deepEqual([...mask.bits], [129, 65]);
  for (let i = 0; i < 15; i++)
    assert.equal(cellIsSet(mask, i % 5 + 0.99, Math.floor(i / 5) + 0.5), [0, 7, 8, 14].includes(i));
  for (const [x, y] of [[-0.1, 0], [5, 0], [0, 3], [0, NaN]]) assert.equal(cellIsSet(mask, x, y), false);
});

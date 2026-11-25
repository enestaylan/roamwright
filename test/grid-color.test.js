import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cutRows, pasteRows } from 'roamwright/runtime/grid-rows.js';
import { SRGB2LIN, dim, acesToColor } from 'roamwright/math/color.js';

test('worker bands with different strides can be transferred and completed out of order', () => {
  const heights = Float32Array.from([1.25, 2.5, 3.75, 4.5, 5.25]);
  const colors = Uint8Array.from({ length: 15 }, (_, i) => i * 7);
  const source = [heights, colors];
  const restored = [new Float32Array(5), new Uint8Array(15)];
  for (const [start, end] of [[4, 5], [0, 2], [2, 4], [5, 5]]) {
    const parts = cutRows(source, 5, start, end);
    const transferred = structuredClone(parts, { transfer: parts.map(part => part.buffer) });
    pasteRows(restored, 5, start, transferred);
  }
  assert.deepEqual(restored, source);
});

test('linear color and filmic response preserve the reference samples', () => {
  assert.deepEqual(dim([1, 0.5, 0.25], 0.5), [0.5, 0.25, 0.125]);
  const digest = createHash('sha256');
  digest.update(new Uint8Array(SRGB2LIN.buffer));
  for (const exposure of [0, 0.5, 1, 2]) {
    for (let i = 0; i < 256; i++) {
      const color = { r: i / 32, g: (255 - i) / 64, b: i / 255 };
      assert.equal(acesToColor(color, exposure), color);
      digest.update(JSON.stringify(color));
    }
  }
  assert.equal(digest.digest('hex'), '9e5245cad32a1bff18338bf7bc9669f12f950e285da8a6944fb7a33b9a20b98c');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { terrainExtension } from 'roamwright/geometry/terrain-extension.js';

test('terrain rings join every boundary vertex once and face upwards on all four sides', () => {
  const { positions, indices, boundary } = terrainExtension({ centerX: 11, centerZ: -8, size: 8, segments: 4, reach: 15, growth: 2 });
  assert.equal(positions.length, 16 * 3 * 3);
  assert.equal(indices.length, 16 * 2 * 6);
  assert.equal(new Set(boundary).size, 16);
  for (let t = 0; t < boundary.length; t++) {
    const ix = boundary[t] % 5;
    const iz = Math.floor(boundary[t] / 5);
    assert.ok(ix === 0 || ix === 4 || iz === 0 || iz === 4);
    assert.equal(positions[3 * t], 7 + ix * 2);
    assert.equal(positions[3 * t + 2], -12 + iz * 2);
  }
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(index => index * 3);
    const twiceArea = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a])
      - (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
    assert.ok(twiceArea > 0);
    area += twiceArea / 2;
  }
  assert.equal(area, 32 ** 2 - 8 ** 2);
});

test('large resolutions retain indices past 65535 and invalid dimensions are rejected', () => {
  const options = { size: 8, segments: 9000, reach: 8, growth: 2 };
  const { indices } = terrainExtension(options);
  assert.ok(indices instanceof Uint32Array);
  assert.equal(indices.at(-1), 71999);
  for (const overrides of [{ reach: 4 }, { segments: 0 }, { growth: 1 }, { centerZ: Infinity }]) {
    assert.throws(() => terrainExtension({ ...options, ...overrides }), RangeError);
  }
});

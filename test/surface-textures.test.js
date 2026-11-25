import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoise } from '../math/noise.js';
import { createHash } from '../math/random.js';
import { createSurfaceTextures, fillPixels } from '../math/surface-textures.js';

const surfaces = seed => createSurfaceTextures({ noise: createNoise(seed), hash2: createHash(seed) });

test('every surface fill writes bytes in range and repeats for the same seed', () => {
  const a = surfaces(7), b = surfaces(7), c = surfaces(8);
  for (const name of Object.keys(a)) {
    const first = fillPixels({ size: 24, make: a[name] }), again = fillPixels({ size: 24, make: b[name] });
    assert.equal(first.length, 24 * 24 * 4, name);
    assert.deepEqual(first, again, name + ' repeats');
    assert.ok(first.some(v => v !== first[0]), name + ' is not flat');
    assert.notDeepEqual(first, fillPixels({ size: 24, make: c[name] }), name + ' follows the seed');
  }
});

test('masonry and brick follow their counts, and ground grain packs a second field in alpha', () => {
  const s = surfaces(3);
  assert.notDeepEqual(fillPixels({ size: 32, make: () => s.ashlar({ courses: 4 }) }), fillPixels({ size: 32, make: () => s.ashlar({ courses: 12 }) }));
  assert.notDeepEqual(fillPixels({ size: 32, make: () => s.brick({ courses: 6 }) }), fillPixels({ size: 32, make: () => s.brick({ courses: 13 }) }));
  const plain = fillPixels({ size: 8, make: s.groundGrain }), packed = fillPixels({ size: 8, make: () => s.groundGrain({ alpha: u => u }) });
  for (let i = 3; i < plain.length; i += 4) assert.equal(plain[i], 255);
  assert.equal(packed[3], Math.round(255 * (0.5 / 8)));
  assert.deepEqual([...plain].filter((_, i) => i % 4 < 3), [...packed].filter((_, i) => i % 4 < 3));
});

test('fillPixels writes the lowest row first and a block layer by layer', () => {
  const rows = fillPixels({ size: 2, make: () => (u, v, o) => { o[0] = v * 100; o[1] = u * 100; } });
  assert.deepEqual([...rows], [75, 25, 0, 255, 75, 75, 0, 255, 25, 25, 0, 255, 25, 75, 0, 255]);
  const block = fillPixels({ size: 1, depth: 2, make: () => (u, v, o, w) => { o[2] = w * 200; } });
  assert.deepEqual([...block], [0, 0, 50, 255, 0, 0, 150, 255]);
});

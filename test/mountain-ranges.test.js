import assert from 'node:assert/strict';
import test from 'node:test';
import { createMountainRanges, crestOf } from 'roamwright/math/mountain-ranges.js';
import { createRockTexture } from 'roamwright/math/rock-texture.js';
import { cellEdge } from 'roamwright/math/cell-edge.js';
import { createHash } from 'roamwright/math/random.js';

test('range samples are deterministic, bounded, and isolated between layouts', () => {
  const specs = [
    { x: -100, z: 0, rx: 240, rz: 120, h: 250, rough: 0.95 },
    { crest: [[-100, 120, 0.9], [20, 160, 1], [240, 140, 0.5]], h: 90, wide: 95, rough: 0.85 },
    { x: 220, z: 0, rx: 250, rz: 170, h: 80, hills: 3, rough: 0.65 },
  ];
  const a = createMountainRanges(12), b = createMountainRanges(12);
  a.layout(specs); b.layout(specs);
  let top = 0, apron = 0;
  for (let x = -500; x < 500; x += 19) for (let z = -350; z < 400; z += 23) {
    const height = a.heightAt(x, z);
    assert.equal(b.heightAt(x, z), height);
    assert.equal(a.surface.scree, b.surface.scree);
    assert.ok(Number.isFinite(height) && height >= 0);
    top = Math.max(height, top);
    apron = Math.max(apron, a.surface.scree);
  }
  assert.ok(top > 100 && apron > 0);
  assert.deepEqual(crestOf(specs[1]), { line: specs[1].crest, wide: 95 });
  const previous = a.heightAt(0, 0);
  b.layout([]);
  assert.equal(b.heightAt(0, 0), 0);
  assert.equal(a.heightAt(0, 0), previous);
  assert.equal(a.heightAt(1e5, 1e5), 0);
  assert.equal(a.surface.scree, 0);
});

test('rock grain and cell identities repeat over the unit tile', () => {
  const hash = createHash(71);
  const fill = createRockTexture(71), a = new Uint8Array(3), b = new Uint8Array(3);
  for (let i = 1; i < 100; i++) {
    const u = i / 128, v = (i * 17 % 128) / 128, c1 = [], c2 = [];
    fill(u, v, a); fill(u + 1, v - 2, b); assert.deepEqual(a, b);
    assert.ok(Math.abs(cellEdge(hash, u, v, 8, 3, c1) - cellEdge(hash, u + 1, v - 2, 8, 3, c2)) < 1e-12);
    assert.deepEqual(c1, c2);
  }
});

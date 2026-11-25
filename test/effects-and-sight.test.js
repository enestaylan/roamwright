import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createInstanceSight } from 'roamwright/motion/instance-sight.js';
import { createTextureFills } from 'roamwright/rendering/texture-fills.js';
import { glowLines } from 'roamwright/rendering/glow-lines.js';
import { glowShell } from 'roamwright/rendering/glow-shell.js';

test('segment outlines and shells share the supplied edge and sampled base', () => {
  const segments = [0, 2, 0, 4, 3, 0];
  const lines = glowLines(segments, 0xffffff);
  const shell = glowShell(segments, x => x / 4, 0xffffff);
  assert.equal(lines.geometry.instanceCount, 1);
  assert.deepEqual([...lines.geometry.attributes.from.data.array], segments);
  assert.deepEqual([...shell.geometry.attributes.position.array], [0,2,0,4,3,0,4,1,0,0,2,0,4,1,0,0,0,0]);
  assert.equal(glowShell(segments, () => 2, 0), null);
});

test('sight bounds respect space, active count, trunk and crown dimensions', () => {
  const index = createInstanceSight();
  const geometry = new THREE.BoxGeometry(2, 4, 2).translate(0, 2, 0);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  const from = { x: 0.3, y: 0.7, z: -4 }, to = { ...from, z: 4 };
  index.add('a', mesh, 0, 0);
  index.add('b', mesh, 0.8, 0.05);
  assert.equal(index.obstructed('a', from, to, 0), true);
  assert.equal(index.obstructed('b', from, to, 0), false);
  mesh.count = 0;
  assert.equal(index.obstructed('a', from, to, 0), false);
  index.clear('a');
  mesh.count = 1;
  assert.equal(index.obstructed('a', from, to, 0), false);
});

test('queued texture fills use their typed view and late synchronous fallback once', async () => {
  const bytes = new Uint8Array([0,4,5,6,7,0]).subarray(1, 5);
  let calls = 0, sync = 0;
  const fills = createTextureFills({
    definitions: { patch: { size: 1 } },
    fillPixels: () => { sync++; return bytes; },
    request: async () => { calls++; return bytes; },
  });
  const tex = fills.filledTexture('patch', { data: true });
  assert.equal(calls, 0);
  await fills.texturesFilled();
  assert.deepEqual([...tex.image.data], [4,5,6,7]);
  assert.equal(calls, 1);
  const later = fills.filledLater('patch');
  later.fillNow();
  await Promise.resolve();
  assert.equal(sync, 1);
  assert.equal(later.texture.version, 1);
});

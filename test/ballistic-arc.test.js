import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { sampleBallisticArc } from 'roamwright/motion/ballistic-arc.js';

test('uses both endpoints and the gravity and duration in world units', () => {
  const a = new Vector3(1, 2, 0), b = new Vector3(3, 4, 2), out = new Vector3();
  assert.deepEqual(sampleBallisticArc(out, a, b, -1, 2), a);
  assert.equal(sampleBallisticArc(out, a, b, 0.5, 2, 10), out);
  assert.deepEqual(out.toArray(), [2, 8, 1]);
  b.set(5, 1, 4);
  assert.deepEqual(sampleBallisticArc(out, a, b, 1, 2), b);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactTransition } from 'roamwright/motion/contact-transition.js';

test('reaches, transfers while holding contact and withdraws once', () => {
  const events = [];
  const step = createContactTransition({ duration: 1, pose: (w, approach) => events.push([w, approach]), transfer: () => events.push('transfer') });
  assert.equal(step(0.24), false);
  assert.deepEqual(events.pop(), [0.5, 0.5]);
  assert.equal(step(0.32), false);
  assert.deepEqual(events.splice(0), [[1, 1], 'transfer']);
  assert.equal(step(1), true);
  assert.deepEqual(events.splice(0), [[0, 1]]);
  assert.equal(step(1), true);
  assert.deepEqual(events, []);
});

test('a skipped hold still reaches the target before transfer', () => {
  const events = [];
  const step = createContactTransition({ duration: 2, pose: weight => events.push(weight), transfer: () => events.push('release') });
  assert.equal(step(3), true);
  assert.deepEqual(events, [1, 'release', 0]);
  assert.throws(() => createContactTransition({ duration: 0 }), RangeError);
  assert.throws(() => createContactTransition({ duration: 1, arriveAt: 0.7 }), RangeError);
});

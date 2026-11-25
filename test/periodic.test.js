import assert from 'node:assert/strict';
import test from 'node:test';
import { cycleDelta, approachPhase } from 'roamwright/math/periodic.js';
test('phases approach along the shortest direction across either end of the cycle', () => {
  assert.equal(cycleDelta(0, 0.5), -0.5);
  assert.equal(cycleDelta(Math.PI, 4 * Math.PI, 2 * Math.PI), -Math.PI);
  assert.equal(approachPhase(0.875, 0.125, 0.125), 0);
  assert.equal(approachPhase(0.125, 0.875, 0.125), 0);
  assert.equal(approachPhase(0, 0.125, 0.125), 0.125);
  assert.equal(approachPhase(0.25, 0.75, 0.125), 0.125);
});

test('arrival fires on reaching the remaining distance even when rounding meets the target early', () => {
  let arrivals = 0;
  const arrive = () => arrivals++;
  const phase = approachPhase(0, 0.25, 0.25 - Number.EPSILON / 4, arrive);
  assert.equal(phase, 0.25);
  assert.equal(arrivals, 0);
  assert.equal(approachPhase(phase, 0.25, 0.01, arrive), 0.25);
  assert.equal(arrivals, 1);
});

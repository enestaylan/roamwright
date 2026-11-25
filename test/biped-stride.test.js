import assert from 'node:assert/strict';
import test from 'node:test';
import { createBipedStride } from 'roamwright/motion/biped-stride.js';

const rig = { hipHeight: 1, thigh: 0.5, shin: 0.48, ankleHeight: 0.07, heelOffset: 0.04, ballOffset: 0.11 };
const foot = {
  heelStrike: [0.25, 0.12], pushOff: [0.5, 0.7], flatAt: 0.18, riseAt: 0.55, reverseRoll: 0.4,
  response: 22, toeReleaseHeight: 0.04, sampleAhead: 0.14, edgeSlope: 0.55, maxSlopeAngle: 0.45,
  groundResponse: [24, 12], snapHeight: 0.9, stairSlope: 0.2, treadRange: [0.2, 0.6], stairMemory: 1,
  stairResponse: 4, stepClearance: [0.5, 0.2], settleSpeed: 1.3, settleLift: 0.045,
};
const pace = {
  baseStep: 0.45, stepGain: 0.25, maxStep: 1.8, walkDuty: 0.57, runDuty: 0.35,
  runFrom: 2.5, runFull: 3, runDip: -0.03, runBob: 0.04, walkLift: 0.09, runLift: 0.24,
  hipResponse: 20, idleRate: 1.2, runLean: 0.14, hipTurn: [0.07, 0.12], hipDrop: 0.04, armLag: 0.05,
};
const walker = () => ({ x: 0, y: 0, z: 0, yaw: 0, fwd: 0, side: 0, spin: 0, slope: 0,
  phase: 0, hip: NaN, lx: 0.11, seed: 0.3 });
test('stride plants feet on ground, transitions to running and keeps independent solver scratch', () => {
  const stride = createBipedStride({rig, foot, pace, ground: (x,z) => 2 + z * 0.1});
  const flat = createBipedStride({rig, foot, pace, ground: () => 0});
  const a = walker(), b = walker(), dt = 1/60;
  const step = (solve, actor) => solve(actor, dt, 1, 0, 0, 0, 0, 0, true, 0);
  const pose = step(stride, a);
  assert.equal(a.y, 2);
  assert.equal(pose.go, 0);
  assert.notEqual(step(flat, b), pose);
  for (let i = 0; i < 200; ++i) {
    a.fwd = i < 100 ? 1 : 4;
    a.z += a.fwd * dt;
    assert.equal(step(stride, a), pose);
    assert.ok(Object.values(pose).every(Number.isFinite));
  }
  assert.equal(pose.run, 1);
  assert.ok(a.y > 2);
  assert.equal(b.y, 0);
});

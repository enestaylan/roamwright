import assert from 'node:assert/strict';
import test from 'node:test';
import { createBipedCycle } from 'roamwright/motion/biped-cycle.js';

const rig = { thigh: 0.5, shin: 0.46, ankleHeight: 0.08, heelOffset: 0.06, ballOffset: 0.18 };
const foot = { heelStrike: 0.24, pushOff: 0.4, flatAt: 0.16, riseAt: 0.62 };
const sample = createBipedCycle({ rig, foot });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' vs ' + expected);

test('the posed heel or toe stays on its contact point through support on a grade', () => {
  for (const grade of [-0.2, 0, 0.2]) for (const duty of [0.44, 0.6]) {
    const stride = 1.25, slope = -Math.atan(grade);
    for (let i = 0; i < 100; i++) {
      const phase = i / 100;
      const { hipHeight, left, right } = sample(phase, stride, duty, 0.08, grade, 1.03);
      for (const [p, leg] of [[phase, left], [(phase + 0.5) % 1, right]]) {
        const shin = leg.thigh + leg.knee, pitch = shin + leg.foot;
        const ankleZ = -rig.thigh * Math.sin(leg.thigh) - rig.shin * Math.sin(shin);
        const ankleY = hipHeight - rig.thigh * Math.cos(leg.thigh) - rig.shin * Math.cos(shin);
        close(ankleY, leg.height);
        close(ankleZ, leg.forward);
        if (p >= duty) continue;
        const toe = pitch > slope + 1e-8, offset = toe ? rig.ballOffset : -rig.heelOffset;
        const z = ankleZ - rig.ankleHeight * Math.sin(pitch) + offset * Math.cos(pitch);
        const y = ankleY - rig.ankleHeight * Math.cos(pitch) - offset * Math.sin(pitch);
        close(y, grade * z);
        close(z + p * stride, duty * stride / 2 + offset * Math.cos(slope));
      }
    }
  }
});
test('phase wraps and sampling independent figures in another order preserves the pose', () => {
  const pose = phase => sample(phase, 1.2, 0.6, 0.07, 0.1, 1);
  const result = pose(0.25), expected = structuredClone(result);
  pose(0.83);
  assert.equal(pose(-0.75), result);
  assert.deepEqual(result, expected);
  assert.deepEqual(pose(1.25), expected);
});

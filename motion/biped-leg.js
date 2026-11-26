import { clamp, lerp, sstep } from '../math/scalar.js';

// Two-bone leg from hip to ankle in the fore-and-aft plane: for an ankle at (forward, up) from the hip, the thigh's and the
// knee's rotation, written into out.
export function solveBipedLeg(out, rig, forward, up, minReach = Math.abs(rig.thigh - rig.shin)) {
  const D = clamp(Math.sqrt(forward * forward + up * up), minReach, rig.thigh + rig.shin - 1e-4),
    bend = Math.acos(clamp((D * D - rig.thigh * rig.thigh - rig.shin * rig.shin) / (2 * rig.thigh * rig.shin), -1, 1));
  out[0] = -(Math.atan2(forward, -up) + Math.atan2(rig.shin * Math.sin(bend), rig.thigh + rig.shin * Math.cos(bend)));
  out[1] = bend;
}
// The pitch of a foot's sole (toes down is more) at share u of its stride: it lands on its heel with the toes up by `strike`,
// lies flat while the body passes over it, rolls up onto its toes until the heel has risen by `push`, and in the air comes
// round from toes down to toes up. A step backwards (`back`) does it the other way round.
export function solePitch(foot, u, duty, back, strike, push) {
  const planted = u < duty;
  let s = planted ? u / duty : (u - duty) / (1 - duty);
  if (back) s = 1 - s;
  return planted ? push * sstep(foot.riseAt, 1, s) - strike * sstep(foot.flatAt, 0, s) : lerp(push, -strike, sstep(0.08, 0.8, s));
}
// Where a foot's ankle is from the point of its sole under the ankle when it lies flat, written into out (forward, up), for a
// sole pitched by `pitch` (about the ball of the foot with the heel up, about the heel with the toes up) on ground that itself
// pitches by `slope` (both radians, toes down is more).
export function ankleOffset(out, rig, pitch, slope) {
  const c = Math.cos(pitch),
    s = Math.sin(pitch),
    forward = pitch >= 0 ? rig.ballOffset - rig.ballOffset * c + rig.ankleHeight * s : -rig.heelOffset + rig.heelOffset * c + rig.ankleHeight * s,
    up = pitch >= 0 ? rig.ballOffset * s + rig.ankleHeight * c : -rig.heelOffset * s + rig.ankleHeight * c;
  if (slope) {
    const cs = Math.cos(slope),
      ss = Math.sin(slope);
    out[0] = forward * cs + up * ss;
    out[1] = up * cs - forward * ss;
  } else {
    out[0] = forward;
    out[1] = up;
  }
}

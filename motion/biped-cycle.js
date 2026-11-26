import { sstep } from '../math/scalar.js';
import { ankleOffset, solePitch, solveBipedLeg } from './biped-leg.js';

/**
 * Sample either a live or baked stride without frame history. Rig lengths, hip
 * height, stride (distance per complete cycle), swing clearance and standing
 * stagger are in the same units. Grade is rise per unit forward; duty is the
 * fraction each foot supports the body. Angles rotate about +X, forward is +Z.
 * The result and both legs are reused until the next call.
 */
export function createBipedCycle({ rig, foot }) {
  const leg = () => ({ thigh: 0, knee: 0, foot: 0, forward: 0, height: 0 });
  const pose = { hipHeight: 0, left: leg(), right: leg() };
  const ankle = [0, 0], angles = [0, 0];
  const reach = rig.thigh + rig.shin - 0.0005;

  function target(leg, phase, stride, duty, clearance, grade, slope, roll, stagger) {
    const swing = Math.max(0, (phase - duty) / (1 - duty));
    // Match ground velocity on both sides of the swing boundary.
    const track = stagger + stride * (duty / 2 - phase + sstep(0, 1, swing));
    const pitch = roll * solePitch(foot, phase, duty, false, foot.heelStrike, foot.pushOff);
    ankleOffset(ankle, rig, pitch, slope);
    const arch = Math.sin(Math.PI * swing);
    leg.forward = track + ankle[0];
    leg.height = grade * track + ankle[1] + clearance * arch * arch;
    leg.foot = pitch + slope;
    pose.hipHeight = Math.min(pose.hipHeight, leg.height + Math.sqrt(Math.max(0, reach * reach - leg.forward * leg.forward)));
  }
  function solve(leg) {
    solveBipedLeg(angles, rig, leg.forward, leg.height - pose.hipHeight);
    leg.thigh = angles[0];
    leg.knee = angles[1];
    leg.foot -= leg.thigh + leg.knee;
  }
  return function sample(phase, stride, duty, clearance, grade, hipHeight, roll = 1, stagger = 0) {
    const cyclePhase = phase - Math.floor(phase), slope = -Math.atan(grade);
    pose.hipHeight = hipHeight;
    target(pose.left, cyclePhase, stride, duty, clearance, grade, slope, roll, -stagger);
    target(pose.right, (cyclePhase + 0.5) % 1, stride, duty, clearance, grade, slope, roll, stagger);
    solve(pose.left);
    solve(pose.right);
    return pose;
  };
}

import { sstep } from '../math/scalar.js';

/**
 * Reach a target, transfer an object once while in contact, then withdraw.
 * Fractions specify the end of the approach, the transfer, and the start of
 * withdrawal. Supply pose(weight, approach, phase) to drive a rig and transfer() to
 * change ownership. Advance the returned function with elapsed seconds.
 * It returns true when finished. Drop it to cancel without a late transfer.
 */
export function createContactTransition({
  duration, pose, transfer, arriveAt = 0.48, transferAt = 0.55, leaveAt = 0.64,
}) {
  if (!(Number.isFinite(duration) && duration > 0 && 0 < arriveAt && arriveAt <= transferAt &&
      transferAt <= leaveAt && leaveAt < 1)) throw new RangeError('Expected positive duration and ordered contact fractions');
  let elapsed = 0, transferred = false;
  return function advance(deltaSeconds) {
    if (elapsed === duration) return true;
    elapsed = Math.min(duration, elapsed + Math.max(0, deltaSeconds));
    const phase = elapsed / duration;
    const approach = sstep(0, arriveAt, phase);
    const weight = approach * (1 - sstep(leaveAt, 1, phase));
    if (!transferred && phase >= transferAt) {
      // A slow frame can cross the entire hold. Establish contact before releasing.
      pose(1, 1, weight === 1 ? phase : transferAt);
      transferred = true;
      transfer();
      if (weight < 1) pose(weight, approach, phase);
    } else {
      pose(weight, approach, phase);
    }
    return elapsed === duration;
  };
}

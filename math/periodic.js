/**
 * `cycleDelta(from,to,period = 1)` returns the shortest signed displacement, with negative half turns.
 * `approachPhase(from,to,step,onArrival?)` advances a normalized clock phase on the shorter arc. Supply phases from
 * zero to one and a nonnegative maximum step in cycles. The optional callback runs when the remaining distance is
 * within that step.
 */
export function cycleDelta(from, to, period = 1) {
  const delta = to - from;
  return delta - Math.round(delta / period) * period;
}

// Advance a normalized phase towards its target by at most step. Snap exactly on arrival.
export function approachPhase(from, to, step, onArrival) {
  const delta = cycleDelta(from, to);
  if (Math.abs(delta) <= step) {
    onArrival?.();
    return to;
  }
  return (from + Math.sign(delta) * step + 1) % 1;
}

/** Wrap an angle in radians to its signed principal value in [-π, π].
 * Unlike cycleDelta, opposite half turns retain the sign of their sine. */
export function wrapRadians(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

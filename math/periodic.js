/**
 * `cycleDelta(from,to,period = 1)` returns the shortest signed displacement, with negative half turns.
 * `approachPhase(from,to,step,onArrival?)` advances a normalized clock phase on the shorter arc. Supply phases from
 * zero to one and a nonnegative maximum step in cycles. The optional callback runs when the remaining distance is
 * within that step.
 */
export function cycleDelta(from, to, period = 1) {
  const d = to - from;
  return d - Math.round(d / period) * period;
}

// Advance a normalized phase towards its target by at most step. Snap exactly on arrival.
export function approachPhase(from, to, step, onArrival) {
  const d = cycleDelta(from, to);
  if (Math.abs(d) <= step) {
    onArrival?.();
    return to;
  }
  return (from + Math.sign(d) * step + 1) % 1;
}

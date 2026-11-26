// Register synchronous, indivisible steps once. The caller retains its queue, priorities and
// cancellation policy. A rejected step did no work and can be tried again next frame.
export function createFrameBudget({ frameMs = 1000 / 60, workMs = 3, reserveMs = 6, maxWaitMs = 100, now = () => performance.now() } = {}) {
  if (!(frameMs > 0 && workMs > 0 && reserveMs >= 0 && reserveMs < frameMs && maxWaitMs >= 0)) throw new RangeError('Invalid frame budget');
  let previous,
    deadline = Infinity,
    remaining = Infinity,
    allowance = workMs;
  let reserved,
    next,
    oldest = Infinity;
  function begin(timestamp = now()) {
    if (previous !== undefined && timestamp - previous > 1.5 * frameMs) allowance = Math.max(workMs / 4, allowance / 2);
    else allowance = Math.min(workMs, allowance + workMs / 8);
    previous = timestamp;
    deadline = timestamp + frameMs - reserveMs;
    remaining = allowance;
    reserved = next;
    next = undefined;
    oldest = Infinity;
  }
  function task(step) {
    let waitingSince;
    return function tryStep(...args) {
      const start = now();
      if (remaining <= 0 || start >= deadline) {
        waitingSince ??= start;
        // Give the longest-waiting producer from the previous frame one turn. If its
        // work disappears, callers simply stop retrying and the reservation expires.
        if (reserved !== tryStep || start - waitingSince < maxWaitMs) {
          if (waitingSince < oldest) {
            oldest = waitingSince;
            next = tryStep;
          }
          return false;
        }
      }
      if (reserved === tryStep) reserved = undefined;
      waitingSince = undefined;
      try {
        step.apply(this, args);
      } finally {
        remaining -= now() - start;
      }
      return true;
    };
  }
  return { begin, task };
}

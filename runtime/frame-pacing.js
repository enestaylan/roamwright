/**
 * Track consecutive slow windows using displayed frame intervals in milliseconds.
 * For each frame call `sample(frameMs)`. After the requested number of slow
 * windows, `onSlow(averageFps, elapsedMs)` fires once. A healthy window rearms
 * the monitor. Call `reset()` when pausing or changing views.
 */
export function createFramePacingMonitor({ minimumFps, windowMs = 1000, windows = 3, onSlow }) {
  if (!(Number.isFinite(minimumFps) && minimumFps > 0 && Number.isFinite(windowMs) && windowMs > 0 &&
        Number.isInteger(windows) && windows > 0 && typeof onSlow === 'function')) throw new RangeError('Invalid frame pacing options');
  let elapsed = 0, frames = 0, misses = 0, slowFrames = 0, slowMs = 0;

  function reset() {
    elapsed = frames = misses = slowFrames = slowMs = 0;
  }
  function sample(frameMs) {
    if (!(Number.isFinite(frameMs) && frameMs > 0)) return;
    elapsed += frameMs;
    frames++;
    if (elapsed < windowMs) return;
    if (frames * 1000 >= minimumFps * elapsed) {
      reset();
      return;
    }
    if (misses < windows) {
      slowFrames += frames;
      slowMs += elapsed;
      misses++;
      if (misses === windows) onSlow(slowFrames * 1000 / slowMs, slowMs);
    }
    elapsed = frames = 0;
  }
  return { sample, reset };
}

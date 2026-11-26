/**
 * Position between two endpoints at a fraction of the flight duration.
 * Coordinates use positive y up and gravity is a positive acceleration.
 * The destination may move between samples. The supplied vector is reused.
 */
export function sampleBallisticArc(out, from, to, phase, duration, gravity = 9.81) {
  const u = Math.min(1, Math.max(0, phase));
  out.lerpVectors(from, to, u);
  out.y += 0.5 * gravity * duration * duration * u * (1 - u);
  return out;
}

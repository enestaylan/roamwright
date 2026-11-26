/**
 * Position between two endpoints at a fraction of the flight duration.
 * Coordinates use positive y up and gravity is a positive acceleration.
 * The destination may move between samples. The supplied vector is reused.
 */
export function sampleBallisticArc(position, from, to, phase, duration, gravity = 9.81) {
  const progress = Math.min(1, Math.max(0, phase));
  position.lerpVectors(from, to, progress);
  position.y += 0.5 * gravity * duration * duration * progress * (1 - progress);
  return position;
}

/**
 * Step along a heading with random turns and an optional directional bias.
 * Returns independent [x, y, z] points, including a copy of the start. The last
 * full step reaches or passes the requested length. Each step draws X, Y and Z
 * in order from the caller's random stream.
 * @param {() => number} random - Generator returning values in [0, 1).
 * @param {number[]} from - Starting point in metres.
 * @param {number[]} direction - Initial heading before the first turn.
 * @param {number} length - Path length in metres.
 * @param {object} options
 * @param {number} options.step - Metres per step.
 * @param {number} options.curl - Strength of a new random turn per step.
 * @param {number} [options.persistence] - Fraction of the previous turn retained.
 * @param {number} [options.verticalScale] - Multiplier for random vertical turns.
 * @param {number[]} [options.pull] - Bias added to each heading before normalization.
 */
export function wanderingPath(random, from, direction, length, { step, curl, persistence = 0, verticalScale = 1, pull }) {
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(length)) throw new RangeError('Expected a positive finite step and a finite length');
  const points = [from.slice()];
  let [dx, dy, dz] = direction,
    tx = 0,
    ty = 0,
    tz = 0;
  for (let s = 0; s < length; s += step) {
    tx = tx * persistence + (random() - 0.5) * curl;
    ty = ty * persistence + (random() - 0.5) * curl * verticalScale;
    tz = tz * persistence + (random() - 0.5) * curl;
    dx += tx + (pull ? pull[0] : 0);
    dy += ty + (pull ? pull[1] : 0);
    dz += tz + (pull ? pull[2] : 0);
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const p = points[points.length - 1];
    points.push([p[0] + dx * step, p[1] + dy * step, p[2] + dz * step]);
  }
  return points;
}

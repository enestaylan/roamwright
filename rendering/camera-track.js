import { Vector3 } from 'three';
import { clamp, lerp } from '../math/scalar.js';

/**
 * Samples a nonempty camera track at a time in seconds. Keys in increasing time order contain
 * [seconds, x, y, z, lookX, lookY, lookZ, cut?, verticalFov?]. A cut holds the previous key
 * until its timestamp. Writes the source key, destination key and eased fraction into `out`.
 */
export function cameraKeyAt(keys, t, out) {
  if (keys.length === 1) {
    out.src = out.dst = keys[0];
    out.u = 0;
    return out;
  }
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
  const currentKey = keys[i],
    nextKey = keys[i + 1],
    cutNext = !!nextKey[7];
  let u = cutNext ? 0 : clamp((t - currentKey[0]) / (nextKey[0] - currentKey[0]), 0, 1);
  u = u * u * (3 - 2 * u);
  out.src = cutNext && t >= nextKey[0] ? nextKey : currentKey;
  out.dst = cutNext ? out.src : nextKey;
  out.u = u;
  return out;
}

/**
 * Creates a sampler for camera position, aim and optional vertical field of view.
 * Positions and numeric targets are offsets from the supplied origin in world units.
 * A key can name a moving target in place of lookX. In that case `resolveTarget(name, out)`
 * must write its current world position into `out`.
 *
 * Call the sampler with (keys, seconds, origin, position, aim). It writes into both output
 * vectors and returns the source lens in degrees, interpolating when both keys specify one.
 * An omitted source lens leaves the application's default framing in control.
 *
 * @param {(name: string, out: Vector3) => void} [resolveTarget] Required for tracks with named targets.
 */
export function createCameraTrackSampler(resolveTarget) {
  const key = { src: null, dst: null, u: 0 };
  const nextAim = new Vector3();

  function targetAt(row, origin, out) {
    if (typeof row[4] === 'string') resolveTarget(row[4], out);
    else out.set(origin.x + row[4], origin.y + row[5], origin.z + row[6]);
  }

  return function sample(keys, seconds, origin, position, aim) {
    const { src, dst, u } = cameraKeyAt(keys, seconds, key);
    position.set(origin.x + lerp(src[1], dst[1], u), origin.y + lerp(src[2], dst[2], u), origin.z + lerp(src[3], dst[3], u));
    targetAt(src, origin, aim);
    if (dst !== src) {
      targetAt(dst, origin, nextAim);
      aim.lerp(nextAim, u);
    }
    return src[8] && dst[8] ? lerp(src[8], dst[8], u) : src[8];
  };
}

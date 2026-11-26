import { Vector3 } from 'three';
import { triangle } from './sculpt.js';
import { dim } from '../math/color.js';
import { clamp, lerp, sstep, TAU } from '../math/scalar.js';

const MM = 0.001,
  ATTACH_REACH = 0.91, // the ear's foot sinks under the sampled skull to cover gaps in the rendered grid
  ATTACH_SPAN = [0.63, 0.38]; // the foot is taller than it is deep, relative to the rim
const alongRim = new Vector3(), acrossRings = new Vector3(), surfaceNormal = new Vector3();

// Model a pinna around the sampled ear root. Height is the head's origin in the builder's frame, in metres.
function buildEar(body, head, side, height, skin, bone) {
  const RINGS = [0, 0.2, 0.4, 0.58, 0.76, 0.9, 1],
    SPOKES = 14,
    warm = clamp(skin[0] * 2.2, 0, 1),
    root = new Vector3();
  head.point(-8, side * 1.72, root, null);
  const at = (i, j) => {
    const r = RINGS[i],
      angle = (j / SPOKES) * TAU,
      up = Math.sin(angle),
      back = (15.5 * Math.cos(angle) * (1 + 0.14 * up) + 1) * r - 2 * (1 - r),
      high = 31 * up * r + 2 * (1 - r),
      rim = sstep(-0.8, -0.45, up) + sstep(-0.45, -0.8, up) * 0.3,
      relief =
        3 * rim * sstep(0.72, 0.9, r) * (1 - 0.4 * sstep(0.92, 1, r)) +
        2 * sstep(-0.9, -0.3, Math.cos(angle)) * sstep(-0.75, -0.2, up) * Math.exp(-((r - 0.5) * (r - 0.5)) / 0.012) -
        7 * sstep(0.42, 0.1, r) +
        3 * Math.exp(-((angle - Math.PI) * (angle - Math.PI)) / 0.16 - ((r - 0.8) * (r - 0.8)) / 0.04),
      out = 1 + (back + 16) * 0.42 + relief;
    return [
      root.x + side * out * MM,
      root.y + height + high * MM,
      root.z - (back + high * 0.18) * MM,
      side,
      0,
      0,
      dim(skin, (1 - 0.4 * sstep(0.45, 0.1, r)) * (1 + 0.08 * warm)),
    ];
  };
  const ringPoints = [];
  for (let i = 0; i < RINGS.length; i++) for (let j = 0; j <= SPOKES; j++) ringPoints.push(at(i, j % SPOKES));
  const pointAt = (i, j) => ringPoints[i * (SPOKES + 1) + j];
  // normals from the neighbours round and across the shell, kept pointing away from the head
  for (let i = 0; i < RINGS.length; i++)
    for (let j = 0; j <= SPOKES; j++) {
      const nextSpoke = pointAt(i, (j + 1) % SPOKES),
        previousSpoke = pointAt(i, (j + SPOKES - 1) % SPOKES),
        outerRing = pointAt(Math.min(RINGS.length - 1, i + 1), j),
        innerRing = pointAt(Math.max(0, i - 1), j);
      alongRim.set(nextSpoke[0] - previousSpoke[0], nextSpoke[1] - previousSpoke[1], nextSpoke[2] - previousSpoke[2]);
      acrossRings.set(outerRing[0] - innerRing[0], outerRing[1] - innerRing[1], outerRing[2] - innerRing[2]);
      surfaceNormal.crossVectors(alongRim, acrossRings).normalize();
      if (!(surfaceNormal.lengthSq() > 0.5)) surfaceNormal.set(side, 0, 0);
      if (surfaceNormal.x * side < 0) surfaceNormal.negate();
      const v = pointAt(i, j);
      v[3] = surfaceNormal.x;
      v[4] = surfaceNormal.y;
      v[5] = surfaceNormal.z;
    }
  for (let i = 0; i < RINGS.length - 1; i++)
    for (let j = 0; j < SPOKES; j++) {
      if (i) triangle(body, pointAt(i, j), pointAt(i, j + 1), pointAt(i + 1, j + 1), null, bone);
      triangle(body, pointAt(i, j), pointAt(i + 1, j + 1), pointAt(i + 1, j), null, bone);
    }

  // Turn the rim into the side of the skull. A single unbacked shell opens against the sky from behind.
  const rim = ringPoints.slice(-(SPOKES + 1), -1).map(point => point.slice());
  const foot = rim.map(point => {
    const y = lerp(root.y, point[1] - height, ATTACH_SPAN[0]),
      z = lerp(root.z, point[2], ATTACH_SPAN[1]);
    let inside = 0, outside = Math.abs(point[0]);
    for (let i = 0; i < 12; i++) {
      const x = (inside + outside) / 2;
      if (head.reach(x, y, z) < ATTACH_REACH) inside = x;
      else outside = x;
    }
    return [side * inside, height + y, z, 0, 0, 0, point[6]];
  });
  for (let j = 0; j < SPOKES; j++) {
    const before = rim[(j + SPOKES - 1) % SPOKES], after = rim[(j + 1) % SPOKES],
      edge = rim[j], base = foot[j];
    alongRim.set(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    acrossRings.set(base[0] - edge[0], base[1] - edge[1], base[2] - edge[2]);
    surfaceNormal.crossVectors(acrossRings, alongRim).normalize().multiplyScalar(side);
    edge[3] = base[3] = surfaceNormal.x;
    edge[4] = base[4] = surfaceNormal.y;
    edge[5] = base[5] = surfaceNormal.z;
  }
  for (let j = 0; j < SPOKES; j++) {
    const next = (j + 1) % SPOKES;
    triangle(body, rim[j], rim[next], foot[next], null, bone);
    triangle(body, rim[j], foot[next], foot[j], null, bone);
  }
}

export { buildEar };

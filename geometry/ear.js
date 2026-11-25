import { Vector3 } from 'three';
import { triangle } from './sculpt.js';
import { dim } from '../math/color.js';
import { clamp, lerp, sstep, TAU } from '../math/scalar.js';

const MM = 0.001,
  ATTACH_REACH = 0.91, // the ear's foot sinks under the sampled skull to cover gaps in the rendered grid
  ATTACH_SPAN = [0.63, 0.38]; // the foot is taller than it is deep, relative to the rim
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

// Model a pinna around the sampled ear root. Height is the head's origin in the builder's frame, in metres.
function buildEar(body, head, s, height, skin, bone) {
  const RINGS = [0, 0.2, 0.4, 0.58, 0.76, 0.9, 1],
    SPOKES = 14,
    warm = clamp(skin[0] * 2.2, 0, 1),
    root = new Vector3();
  head.point(-8, s * 1.72, root, null);
  const at = (i, j) => {
    const r = RINGS[i],
      a = (j / SPOKES) * TAU,
      up = Math.sin(a),
      back = (15.5 * Math.cos(a) * (1 + 0.14 * up) + 1) * r - 2 * (1 - r),
      high = 31 * up * r + 2 * (1 - r),
      rim = sstep(-0.8, -0.45, up) + sstep(-0.45, -0.8, up) * 0.3,
      relief =
        3 * rim * sstep(0.72, 0.9, r) * (1 - 0.4 * sstep(0.92, 1, r)) +
        2 * sstep(-0.9, -0.3, Math.cos(a)) * sstep(-0.75, -0.2, up) * Math.exp(-((r - 0.5) * (r - 0.5)) / 0.012) -
        7 * sstep(0.42, 0.1, r) +
        3 * Math.exp(-((a - Math.PI) * (a - Math.PI)) / 0.16 - ((r - 0.8) * (r - 0.8)) / 0.04),
      out = 1 + (back + 16) * 0.42 + relief;
    return [
      root.x + s * out * MM,
      root.y + height + high * MM,
      root.z - (back + high * 0.18) * MM,
      s,
      0,
      0,
      dim(skin, (1 - 0.4 * sstep(0.45, 0.1, r)) * (1 + 0.08 * warm)),
    ];
  };
  const P = [];
  for (let i = 0; i < RINGS.length; i++) for (let j = 0; j <= SPOKES; j++) P.push(at(i, j % SPOKES));
  const p = (i, j) => P[i * (SPOKES + 1) + j];
  // normals from the neighbours round and across the shell, kept pointing away from the head
  for (let i = 0; i < RINGS.length; i++)
    for (let j = 0; j <= SPOKES; j++) {
      const a = p(i, (j + 1) % SPOKES),
        b = p(i, (j + SPOKES - 1) % SPOKES),
        c = p(Math.min(RINGS.length - 1, i + 1), j),
        d = p(Math.max(0, i - 1), j);
      _a.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      _b.set(c[0] - d[0], c[1] - d[1], c[2] - d[2]);
      _c.crossVectors(_a, _b).normalize();
      if (!(_c.lengthSq() > 0.5)) _c.set(s, 0, 0);
      if (_c.x * s < 0) _c.negate();
      const v = p(i, j);
      v[3] = _c.x;
      v[4] = _c.y;
      v[5] = _c.z;
    }
  for (let i = 0; i < RINGS.length - 1; i++)
    for (let j = 0; j < SPOKES; j++) {
      if (i) triangle(body, p(i, j), p(i, j + 1), p(i + 1, j + 1), null, bone);
      triangle(body, p(i, j), p(i + 1, j + 1), p(i + 1, j), null, bone);
    }

  // Turn the rim into the side of the skull. A single unbacked shell opens against the sky from behind.
  const rim = P.slice(-(SPOKES + 1), -1).map(point => point.slice());
  const foot = rim.map(point => {
    const y = lerp(root.y, point[1] - height, ATTACH_SPAN[0]),
      z = lerp(root.z, point[2], ATTACH_SPAN[1]);
    let inside = 0, outside = Math.abs(point[0]);
    for (let i = 0; i < 12; i++) {
      const x = (inside + outside) / 2;
      if (head.reach(x, y, z) < ATTACH_REACH) inside = x;
      else outside = x;
    }
    return [s * inside, height + y, z, 0, 0, 0, point[6]];
  });
  for (let j = 0; j < SPOKES; j++) {
    const before = rim[(j + SPOKES - 1) % SPOKES], after = rim[(j + 1) % SPOKES],
      edge = rim[j], base = foot[j];
    _a.set(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    _b.set(base[0] - edge[0], base[1] - edge[1], base[2] - edge[2]);
    _c.crossVectors(_b, _a).normalize().multiplyScalar(s);
    edge[3] = base[3] = _c.x;
    edge[4] = base[4] = _c.y;
    edge[5] = base[5] = _c.z;
  }
  for (let j = 0; j < SPOKES; j++) {
    const next = (j + 1) % SPOKES;
    triangle(body, rim[j], rim[next], foot[next], null, bone);
    triangle(body, rim[j], foot[next], foot[j], null, bone);
  }
}

export { buildEar };

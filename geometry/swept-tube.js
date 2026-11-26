import { TAU } from '../math/scalar.js';

/**
 * Append an uncapped tube along an ordered, smoothly turning path to a GeometryBuilder.
 * Points and radii are in local metres. Applies the builder's translation, emits radial
 * normals and two unindexed triangles per side per span. Repeated points retain their
 * ring, so the emitted vertex count depends only on point count and sides.
 * @param {import('./builder.js').GB} builder
 * @param {number[][]} points - Ordered [x, y, z] centers.
 * @param {object} options
 * @param {number} options.sides - At least three vertices per ring.
 * @param {number | ((fraction: number, index: number) => number)} options.radius - Constant radius or profile sampled by fraction of path length.
 * @param {number[]} options.color - Linear RGB.
 * @param {(fraction: number, index: number) => number} [options.shade] - Optional multiplier sampled once per ring.
 * @param {boolean} [options.clockwise] - Reverse the outward triangle winding while retaining radial normals.
 * @param {(point: number[], radius: number) => number} [options.centerY] - Optional adjusted center height after computing the path frame.
 */
export function sweepTube(builder, points, { sides, radius, color, shade, centerY, clockwise = false }) {
  if (!Number.isInteger(sides) || sides < 3) throw new RangeError('A tube needs at least three sides');
  if (points.length < 2) return;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i];
    distances.push(distances[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
  }
  const length = distances[points.length - 1] || 1;
  let nx = 0, ny = 0, nz = 0;
  let previous = new Float64Array((sides + 1) * 6), ring = new Float64Array(previous.length);
  let lastTx = 0, lastTy = 1, lastTz = 0, lastTint = 1;
  function vertex(row, side, tint) {
    const at = side * 6;
    builder.raw(row[at], row[at + 1], row[at + 2], row[at + 3], row[at + 4], row[at + 5],
      color[0] * tint, color[1] * tint, color[2] * tint);
  }
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    let tx = after[0] - before[0], ty = after[1] - before[1], tz = after[2] - before[2];
    const tangentLength = Math.hypot(tx, ty, tz);
    if (tangentLength === 0) {
      tx = lastTx;
      ty = lastTy;
      tz = lastTz;
    } else {
      tx /= tangentLength;
      ty /= tangentLength;
      tz /= tangentLength;
    }
    // Project the previous normal into the new ring's plane to avoid twisting.
    if (i === 0) [nx, ny, nz] = Math.abs(ty) < 0.9 ? [-tz, 0, tx] : [1, 0, 0];
    const dot = nx * tx + ny * ty + nz * tz;
    nx -= dot * tx;
    ny -= dot * ty;
    nz -= dot * tz;
    let normalLength = Math.hypot(nx, ny, nz);
    if (normalLength < 1e-12) {
      [nx, ny, nz] = Math.abs(ty) < 0.9 ? [-tz, 0, tx] : [0, tz, -ty];
      normalLength = Math.hypot(nx, ny, nz);
    }
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const fraction = distances[i] / length, p = points[i];
    const r = typeof radius === 'function' ? radius(fraction, i) : radius;
    const tint = shade ? shade(fraction, i) : 1;
    const y = centerY ? centerY(p, r) : p[1];
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * TAU, cos = Math.cos(angle), sin = Math.sin(angle);
      const ex = nx * cos + bx * sin, ey = ny * cos + by * sin, ez = nz * cos + bz * sin;
      const at = j * 6;
      ring[at] = p[0] + ex * r + builder.ox;
      ring[at + 1] = y + ey * r + builder.oy;
      ring[at + 2] = p[2] + ez * r + builder.oz;
      ring[at + 3] = ex;
      ring[at + 4] = ey;
      ring[at + 5] = ez;
    }
    if (i > 0) {
      for (let face = 0; face < sides; face++) {
        const j = clockwise ? face : sides - face;
        const next = clockwise ? j + 1 : j - 1;
        vertex(previous, j, lastTint);
        vertex(ring, j, tint);
        vertex(ring, next, tint);
        vertex(previous, j, lastTint);
        vertex(ring, next, tint);
        vertex(previous, next, lastTint);
      }
    }
    const swap = previous;
    previous = ring;
    ring = swap;
    lastTx = tx;
    lastTy = ty;
    lastTz = tz;
    lastTint = tint;
  }
}

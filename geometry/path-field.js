/**
 * Measure the distance to a path or bake a sampled route into row-major terrain grids.
 * @module
 */

import { clamp } from '../math/scalar.js';

/**
 * @param {[number, number][]} line - Ordered X/Z points in world units.
 * @returns {[number, number, number, number]} Bounds in the order [minX, maxX, minZ, maxZ].
 */
function pathBox(line) {
  const box = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, z] of line) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.max(box[1], x);
    box[2] = Math.min(box[2], z);
    box[3] = Math.max(box[3], z);
  }
  return box;
}

/**
 * Find the closest point on a path strictly inside the search radius.
 * @param {{line: [number, number][], box: ReturnType<typeof pathBox>}} c - Polyline with its current bounds.
 * @param {number} x - Query X in world units.
 * @param {number} z - Query Z in world units.
 * @param {number} reach - Maximum search distance in the same units.
 * @param {{d?: number, t?: number, side?: number}} near - Caller-owned result. On a hit, d is the distance,
 *   t is the fractional segment index divided by the segment count, and side is the sign of the X/Z
 *   cross product of the segment direction with the query offset (positive for a point on the line).
 * @returns True on a hit. A miss leaves the result intact.
 */
function nearestPathPoint(c, x, z, reach, near) {
  const b = c.box;
  if (x < b[0] - reach || x > b[1] + reach || z < b[2] - reach || z > b[3] + reach) return false;
  let best = reach * reach,
    at = -1;
  for (let i = 0; i < c.line.length - 1; i++) {
    const p = c.line[i],
      q = c.line[i + 1],
      dx = q[0] - p[0],
      dz = q[1] - p[1],
      px = x - p[0],
      pz = z - p[1],
      t = clamp((px * dx + pz * dz) / (dx * dx + dz * dz), 0, 1),
      d = (px - dx * t) ** 2 + (pz - dz * t) ** 2;
    if (d < best) {
      best = d;
      at = (i + t) / (c.line.length - 1);
      near.side = dx * pz - dz * px < 0 ? -1 : 1;
    }
  }
  if (at < 0) return false;
  near.d = Math.sqrt(best);
  near.t = at;
  return true;
}

/**
 * Update the grid around each path sample with the smallest distance seen so far.
 * Initialise a fresh distance grid with Infinity. The radius bounds a square of candidate
 * cells, so a written distance near a corner can exceed the radius. Densify long
 * segments before stamping if intermediate positions should also contribute.
 * @param {{x0: number, z0: number, width: number, height: number, spacing: number}} layout -
 *   Origin in world units, dimensions in samples and spacing in world units.
 * @param {[number, number][]} pts - Path samples in world X/Z.
 * @param {number} radius - Nonnegative search extent in world units.
 * @param {Float32Array | Float64Array | number[]} grid - Writable row-major nearest distances.
 * @param {Float32Array | Float64Array | number[] | null} [valueGrid] - Optional companion grid updated when a sample wins.
 * @param {(t: number) => number} [valueFn] - Value at the normalized point index. Defaults to zero.
 */
function stampPath({ x0, z0, width, height, spacing }, pts, radius, grid, valueGrid, valueFn) {
  if (!(spacing > 0) || !Number.isFinite(spacing) || !Number.isFinite(radius) || radius < 0) throw new RangeError('Expected positive spacing and a nonnegative radius');
  const rc = Math.ceil(radius / spacing);
  for (let s = 0; s < pts.length; s++) {
    const px = pts[s][0],
      pz = pts[s][1],
      ci = Math.round((px - x0) / spacing),
      cj = Math.round((pz - z0) / spacing);
    const val = valueFn ? valueFn(pts.length > 1 ? s / (pts.length - 1) : 0) : 0;
    for (let j = Math.max(0, cj - rc); j <= Math.min(height - 1, cj + rc); j++) {
      for (let i = Math.max(0, ci - rc); i <= Math.min(width - 1, ci + rc); i++) {
        const d = Math.hypot(i * spacing + x0 - px, j * spacing + z0 - pz),
          k = j * width + i;
        if (d < grid[k]) {
          grid[k] = d;
          if (valueGrid) valueGrid[k] = val;
        }
      }
    }
  }
}

export { nearestPathPoint, pathBox, stampPath };

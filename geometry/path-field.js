/**
 * Measure the distance to a path or bake a sampled route into row-major terrain grids.
 * @module
 */

import { clamp } from '../math/scalar.js';

/** Distance in world units from an X/Z point to a finite segment, including coincident endpoints.
 * @param {number} x
 * @param {number} z
 * @param {[number, number]} start
 * @param {[number, number]} end
 */
export function segmentDistance(x, z, start, end) {
  const dx = end[0] - start[0], dz = end[1] - start[1];
  const px = x - start[0], pz = z - start[1];
  const fraction = clamp((px * dx + pz * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - dx * fraction, pz - dz * fraction);
}

/** Test an X/Z point against an implicitly closed polygon using the even-odd rule.
 * A horizontal scan includes its left crossing and excludes its right crossing.
 * @param {[number, number][]} ring
 * @param {number} x
 * @param {number} z
 */
export function ringContains(ring, x, z) {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const start = ring[i], end = ring[(i + 1) % ring.length];
    if (start[1] > z !== end[1] > z && x < ((end[0] - start[0]) * (z - start[1])) / (end[1] - start[1]) + start[0]) {
      inside = !inside;
    }
  }
  return inside;
}

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
 * @param {{line: [number, number][], box: ReturnType<typeof pathBox>}} path - Polyline with its current bounds.
 * @param {number} x - Query X in world units.
 * @param {number} z - Query Z in world units.
 * @param {number} reach - Maximum search distance in the same units.
 * @param {{d?: number, t?: number, side?: number}} near - Caller-owned result. On a hit, d is the distance,
 *   t is the fractional segment index divided by the segment count, and side is the sign of the X/Z
 *   cross product of the segment direction with the query offset (positive for a point on the line).
 * @returns True on a hit. A miss leaves the result intact.
 */
function nearestPathPoint(path, x, z, reach, near) {
  const bounds = path.box;
  if (x < bounds[0] - reach || x > bounds[1] + reach || z < bounds[2] - reach || z > bounds[3] + reach) return false;
  let best = reach * reach,
    at = -1;
  for (let i = 0; i < path.line.length - 1; i++) {
    const segmentStart = path.line[i],
      segmentEnd = path.line[i + 1],
      dx = segmentEnd[0] - segmentStart[0],
      dz = segmentEnd[1] - segmentStart[1],
      px = x - segmentStart[0],
      pz = z - segmentStart[1],
      segmentFraction = clamp((px * dx + pz * dz) / (dx * dx + dz * dz), 0, 1),
      distanceSquared = (px - dx * segmentFraction) ** 2 + (pz - dz * segmentFraction) ** 2;
    if (distanceSquared < best) {
      best = distanceSquared;
      at = (i + segmentFraction) / (path.line.length - 1);
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
 * @param {[number, number][]} points - Path samples in world X/Z.
 * @param {number} radius - Nonnegative search extent in world units.
 * @param {Float32Array | Float64Array | number[]} grid - Writable row-major nearest distances.
 * @param {Float32Array | Float64Array | number[] | null} [valueGrid] - Optional companion grid updated when a sample wins.
 * @param {(t: number) => number} [valueFn] - Value at the normalized point index. Defaults to zero.
 */
function stampPath({ x0, z0, width, height, spacing }, points, radius, grid, valueGrid, valueFn) {
  if (!(spacing > 0) || !Number.isFinite(spacing) || !Number.isFinite(radius) || radius < 0) throw new RangeError('Expected positive spacing and a nonnegative radius');
  const cellRadius = Math.ceil(radius / spacing);
  for (let sampleIndex = 0; sampleIndex < points.length; sampleIndex++) {
    const px = points[sampleIndex][0],
      pz = points[sampleIndex][1],
      centreColumn = Math.round((px - x0) / spacing),
      centreRow = Math.round((pz - z0) / spacing);
    const sampleValue = valueFn ? valueFn(points.length > 1 ? sampleIndex / (points.length - 1) : 0) : 0;
    for (let j = Math.max(0, centreRow - cellRadius); j <= Math.min(height - 1, centreRow + cellRadius); j++) {
      for (let i = Math.max(0, centreColumn - cellRadius); i <= Math.min(width - 1, centreColumn + cellRadius); i++) {
        const distance = Math.hypot(i * spacing + x0 - px, j * spacing + z0 - pz),
          cellIndex = j * width + i;
        if (distance < grid[cellIndex]) {
          grid[cellIndex] = distance;
          if (valueGrid) valueGrid[cellIndex] = sampleValue;
        }
      }
    }
  }
}

export { nearestPathPoint, pathBox, stampPath };

/**
 * Measure signed distance to a land outline directly or bake distances for repeated shoreline queries.
 * @module
 */

import { clamp, lerp } from '../math/scalar.js';

/**
 * Prepare edges once for repeated {@link outlineDistance} queries. The last point connects to the first.
 * @param {[number, number][]} outline - Ordered [x, z] vertices of a closed polygon in metres.
 */
export const outlineEdges = outline =>
  outline.map(([x, z], i) => {
    const [ex, ez] = outline[(i + 1) % outline.length],
      dx = ex - x,
      dz = ez - z;
    return { x, z, dx, dz, ez, inv: 1 / (dx * dx + dz * dz || 1) };
  });
/**
 * Measure distance to the closest point on a polygon edge. The sign is positive
 * inland, zero on the boundary and negative outside, for either winding order.
 * @param {ReturnType<typeof outlineEdges>} edges - Precomputed edges of one land outline.
 * @param {number} x - World X in metres.
 * @param {number} z - World Z in metres.
 */
export function outlineDistance(edges, x, z) {
  let inside = false,
    best = Infinity;
  for (const e of edges) {
    const px = x - e.x,
      pz = z - e.z;
    if (e.z > z !== e.ez > z && px < (pz * e.dx) / e.dz) inside = !inside;
    const t = clamp((px * e.dx + pz * e.dz) * e.inv, 0, 1);
    best = Math.min(best, (px - e.dx * t) ** 2 + (pz - e.dz * t) ** 2);
  }
  return Math.sqrt(best) * (inside ? 1 : -1);
}

/**
 * Cache shoreline distances for frequent terrain or material queries. Allocate a
 * square grid, bake one or more land outlines, then sample it by world position.
 * Baking keeps the largest signed distance across all outlines at each grid point.
 * Queries interpolate four neighbouring samples and clamp to the grid near its edge.
 * @example
 * ```js
 * import { createShoreGrid } from 'roamwright/geometry/shore-grid.js';
 *
 * const shore = createShoreGrid();
 * shore.layOutShore(-8, -8, 1, 17);
 * shore.bakeShore([[[-4, -4], [4, -4], [4, 4], [-4, 4]]]);
 * const inland = shore.shoreDistance(0, 0); // 4 metres
 * const offshore = shore.shoreDistance(6, 0); // -2 metres
 * ```
 */
export function createShoreGrid() {
  let grid = null, // the distances, n to a side
    n = 0,
    x0 = 0,
    z0 = 0,
    step = 0; // metres from one point of the grid to the next

  /**
   * Replace any existing grid with zeroed storage.
   * @param {number} cornerX - Smallest sample X in metres.
   * @param {number} cornerZ - Smallest sample Z in metres.
   * @param {number} spacing - Positive distance between samples in metres.
   * @param {number} points - Samples along each side, at least two.
   */
  function layOutShore(cornerX, cornerZ, spacing, points) {
    x0 = cornerX;
    z0 = cornerZ;
    step = spacing;
    n = points;
    grid = new Float32Array(n * n);
  }
  /**
   * Restore a matching cached grid by writing into this buffer after layout.
   * @returns {Float32Array | null} The live row-major distances, or null before layout.
   */
  const shoreGrid = () => grid;
  /** @param {[number, number][][]} outlines - Land polygons to rasterize into the allocated grid. */
  function bakeShore(outlines) {
    const edges = outlines.map(outlineEdges);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step,
          z = z0 + j * step;
        let d = -Infinity;
        for (const outline of edges) d = Math.max(d, outlineDistance(outline, x, z));
        grid[j * n + i] = d;
      }
  }
  /**
   * @param {number} x - World X in metres.
   * @param {number} z - World Z in metres.
   * @returns {number} Interpolated signed distance in metres, positive inland.
   */
  function shoreDistance(x, z) {
    const u = clamp((x - x0) / step, 0, n - 1.001),
      v = clamp((z - z0) / step, 0, n - 1.001),
      i = Math.floor(u),
      j = Math.floor(v),
      a = u - i,
      b = v - j,
      k = j * n + i;
    return lerp(lerp(grid[k], grid[k + 1], a), lerp(grid[k + n], grid[k + n + 1], a), b);
  }

  return { bakeShore, layOutShore, shoreDistance, shoreGrid };
}

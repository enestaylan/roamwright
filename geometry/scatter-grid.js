/**
 * Place repeatable patches of scenery around a moving observer.
 * @module
 */

/**
 * Sample one candidate per world cell around the observer. Each level scans a square.
 * The fill callback decides which candidates to keep. A rejected candidate leaves its
 * output index available to the next one. Ring bounds are available to `finish` for
 * fading or clipping overlap between levels.
 * @param {object} options - Sampling levels and callbacks.
 * @param {{cell: number, half: number, refill: number}[]} options.rings - Levels from fine to coarse.
 *   Cell width and refill distance are in world units. At full density each side spans `2 * half` cells.
 * @param {(col: number, row: number, seed: number) => number} options.hash - Repeatable offset in [0, 1).
 * @param {[number, number]} options.seeds - Separate hash seeds for the X and Z offsets.
 * @param {(level: number, index: number, x: number, z: number, h1: number, h2: number, col: number, row: number, cell: number) => boolean} options.fill -
 *   Write the candidate at the supplied index and return true to count it.
 * @param {(level: number) => void} [options.start] - Called before a level refills so its old output can be cleared.
 * @param {(grids: {cell: number, count: number, inner: number, outer: number}[]) => void} [options.finish] -
 *   Called once after any levels refill. Counts and bounds describe the current levels and are reused on later updates.
 * @returns {(x: number, z: number, density?: number) => boolean} Update using world X/Z. Density scales each
 *   level’s half-width from zero to full size. Returns true when at least one level refills.
 * @example
 * ```js
 * import { createHash } from 'roamwright/math/random.js';
 * import { createScatterGrid } from 'roamwright/geometry/scatter-grid.js';
 *
 * const trees = [];
 * const update = createScatterGrid({
 *   rings: [{ cell: 8, half: 2, refill: 4 }],
 *   hash: createHash(42), seeds: [1, 2],
 *   start() { trees.length = 0; },
 *   fill(level, index, x, z) {
 *     trees[index] = [x, z];
 *     return true;
 *   },
 * });
 * update(0, 0); // 16 tree positions
 * update(1, 0); // false, still inside the refill distance
 * ```
 */
export function createScatterGrid({ rings, hash, seeds, fill, start, finish }) {
  const grids = rings.map(ring => ({ ...ring, x: Infinity, z: Infinity, halfUsed: -1, count: 0, inner: 0, outer: 0 }));
  const update = (x, z, density = 1) => {
    let changed = false;
    let inner = 0;
    for (let level = 0; level < grids.length; level++) {
      const grid = grids[level];
      const half = Math.round(grid.half * Math.max(0, Math.min(1, density)));
      grid.inner = inner;
      grid.outer = Math.max(inner, half * grid.cell - grid.refill);
      inner = grid.outer;
      if (grid.halfUsed === half && Math.abs(x - grid.x) + Math.abs(z - grid.z) < grid.refill) continue;
      const ix = Math.floor(x / grid.cell), iz = Math.floor(z / grid.cell);
      grid.x = x;
      grid.z = z;
      grid.halfUsed = half;
      grid.count = 0;
      start?.(level);
      for (let row = iz - half; row < iz + half; row++) {
        for (let col = ix - half; col < ix + half; col++) {
          const h1 = hash(col, row, seeds[0]), h2 = hash(col, row, seeds[1]);
          if (fill(level, grid.count, (col + h1) * grid.cell, (row + h2) * grid.cell, h1, h2, col, row, grid.cell)) grid.count++;
        }
      }
      changed = true;
    }
    if (changed) finish?.(grids);
    return changed;
  };
  return update;
}

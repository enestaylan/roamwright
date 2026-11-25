// Deterministic cell samples around a moving observer, from fine inner cover to coarse outer cover.
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

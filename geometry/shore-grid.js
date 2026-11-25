import { clamp, lerp } from '../math/scalar.js';

// The edges of a closed outline, as the distance to it is worked out from them.
export const outlineEdges = outline =>
  outline.map(([x, z], i) => {
    const [ex, ez] = outline[(i + 1) % outline.length],
      dx = ex - x,
      dz = ez - z;
    return { x, z, dx, dz, ez, inv: 1 / (dx * dx + dz * dz || 1) };
  });
// The signed distance from (x, z) to an outline's edges: positive inside it.
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

export function createShoreGrid() {
  let grid = null, // the distances, n to a side
    n = 0,
    x0 = 0,
    z0 = 0,
    step = 0; // metres from one point of the grid to the next

  // Lays the grid out empty over the square from (x0, z0): n points a side, `step` metres apart.
  function layOutShore(cornerX, cornerZ, spacing, points) {
    x0 = cornerX;
    z0 = cornerZ;
    step = spacing;
    n = points;
    grid = new Float32Array(n * n);
  }
  // The grid's distances: what a bake fills and a later visit reads back (core/kept.js).
  const shoreGrid = () => grid;
  // Fills the grid from the land's outlines, each a closed line of [x, z] points.
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
  // The signed distance from (x, z) to the shore, in metres: positive inland.
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

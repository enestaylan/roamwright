import { outlineDistance, outlineEdges } from './shore-grid.js';

// A closed outline's signed distance (metres, negative inside) baked on a grid over its box, `pad` metres wider than the outline:
// plain numbers and an array, which can be handed to a worker of the pool.
function polyGrid(poly, cell, pad) {
  if (!poly.length || !Number.isFinite(cell) || cell <= 0 || !Number.isFinite(pad) || pad < 0) throw new RangeError('Provide an outline, positive cell size and nonnegative padding');
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  x0 -= pad;
  z0 -= pad;
  x1 += pad;
  z1 += pad;
  const nx = Math.max(2, Math.ceil((x1 - x0) / cell) + 1),
    nz = Math.max(2, Math.ceil((z1 - z0) / cell) + 1),
    g = new Float32Array(nx * nz),
    edges = outlineEdges(poly);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) g[j * nx + i] = -outlineDistance(edges, x0 + i * cell, z0 + j * cell);
  return { x0, z0, x1, z1, nx, nz, cell, pad, g };
}
// The signed distance anywhere, read from a grid of polyGrid's; beyond the box, the distance to the box.
function gridField({ x0, z0, x1, z1, nx, nz, cell, pad, g }) {
  return (x, z) => {
    const gridX = (x - x0) / cell,
      gridZ = (z - z0) / cell;
    if (gridX < 0 || gridZ < 0 || gridX > nx - 1 || gridZ > nz - 1) return pad + Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
    const i = Math.min(nx - 2, gridX | 0),
      j = Math.min(nz - 2, gridZ | 0),
      u = gridX - i,
      v = gridZ - j,
      k = j * nx + i;
    return (g[k] * (1 - u) + g[k + 1] * u) * (1 - v) + (g[k + nx] * (1 - u) + g[k + nx + 1] * u) * v;
  };
}
// A closed outline as a signed distance, baked once on a grid over its box (polyGrid).
const polyField = (poly, cell, pad) => gridField(polyGrid(poly, cell, pad));

export { gridField, polyField, polyGrid };

// Sample the triangles of a regular, axis-aligned X/Z PlaneGeometry in geometry coordinates.
// The first vertex is the minimum X and Z; the index follows Three.js PlaneGeometry's diagonal.
export function heightfieldSampler(geometry, outside) {
  const { widthSegments: columns, heightSegments: rows } = geometry.parameters;
  const positions = geometry.getAttribute('position');
  const x0 = positions.getX(0);
  const z0 = positions.getZ(0);
  const width = positions.getX(columns) - x0;
  const depth = positions.getZ(rows * (columns + 1)) - z0;
  if (!(width > 0 && depth > 0)) throw new RangeError('Expected a regular heightfield in the X/Z plane');
  return (x, z) => {
    const fx = (x - x0) / width * columns;
    const fz = (z - z0) / depth * rows;
    if (fx < 0 || fz < 0 || fx > columns || fz > rows) return outside?.(x, z);
    const col = Math.min(Math.floor(fx), columns - 1);
    const row = Math.min(Math.floor(fz), rows - 1);
    const u = fx - col, v = fz - row;
    const k = row * (columns + 1) + col;
    const b = positions.getY(k + columns + 1);
    const d = positions.getY(k + 1);
    if (u + v <= 1) {
      const a = positions.getY(k);
      return a + (d - a) * u + (b - a) * v;
    }
    const c = positions.getY(k + columns + 2);
    return c + (b - c) * (1 - u) + (d - c) * (1 - v);
  };
}

// Replace a square of regular cells by a finer patch. The caller builds its mesh, materials and
// attributes with the supplied height function and returns its geometry. Call during construction.
export function refineHeightfield(base, { x, z, cells, subdivisions, height, createPatch }) {
  const { widthSegments: columns, heightSegments: rows } = base.parameters;
  if (!(Number.isInteger(cells) && cells > 0 && cells <= Math.min(columns, rows) &&
      Number.isInteger(subdivisions) && subdivisions >= 2 && Number.isFinite(x) && Number.isFinite(z))) {
    throw new RangeError('Invalid heightfield patch dimensions or position');
  }
  if (!base.index || base.index.count !== rows * columns * 6) throw new TypeError('Expected an indexed PlaneGeometry');
  const positions = base.getAttribute('position');
  const x0 = positions.getX(0), z0 = positions.getZ(0);
  const dx = (positions.getX(columns) - x0) / columns;
  const dz = (positions.getZ(rows * (columns + 1)) - z0) / rows;
  const col = Math.round((x - x0) / dx - cells / 2);
  const row = Math.round((z - z0) / dz - cells / 2);
  if (col < 0 || row < 0 || col + cells > columns || row + cells > rows) {
    throw new RangeError('Heightfield patch extends past the base grid');
  }
  const coarse = heightfieldSampler(base, height);
  const cx = x0 + (col + cells / 2) * dx, cz = z0 + (row + cells / 2) * dz;
  const width = cells * dx, depth = cells * dz;
  const patch = createPatch({
    x: cx, z: cz, width, depth, segments: cells * subdivisions,
    height(px, pz) {
      const weight = Math.min((width / 2 - Math.abs(px - cx)) / dx, (depth / 2 - Math.abs(pz - cz)) / dz);
      if (weight >= 1) return height(px, pz);
      const edge = coarse(px, pz);
      return weight <= 0 ? edge : edge + (height(px, pz) - edge) * weight;
    },
  });
  const sample = heightfieldSampler(patch, coarse);
  // Keep the base vertex and index layout for other disjoint patches and external attributes.
  for (let r = row; r < row + cells; r++) {
    const start = (r * columns + col) * 6;
    base.index.array.fill(0, start, start + cells * 6);
  }
  base.index.needsUpdate = true;
  return sample;
}

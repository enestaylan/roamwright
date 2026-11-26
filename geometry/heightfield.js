/**
 * Sample and refine regular terrain grids in local X/Z coordinates. Heights follow the triangles used to render the surface.
 * @module
 */

/**
 * Interpolate height on the same triangle that the renderer draws.
 * @param {import('three').PlaneGeometry} geometry - Regular X/Z grid whose first vertex has the smallest X and Z.
 * @param {(x: number, z: number) => number} [outside] - Fallback height beyond the grid.
 * @returns {(x: number, z: number) => (number | undefined)} A sampler in local geometry coordinates. Outside the grid it returns the fallback height, or undefined.
 */
export function heightfieldSampler(geometry, outside) {
  const { widthSegments: columns, heightSegments: rows } = geometry.parameters;
  const positions = geometry.getAttribute('position');
  const x0 = positions.getX(0);
  const z0 = positions.getZ(0);
  const width = positions.getX(columns) - x0;
  const depth = positions.getZ(rows * (columns + 1)) - z0;
  if (!(width > 0 && depth > 0)) throw new RangeError('Expected a regular heightfield in the X/Z plane');
  return (x, z) => {
    const gridX = (x - x0) / width * columns;
    const gridZ = (z - z0) / depth * rows;
    if (gridX < 0 || gridZ < 0 || gridX > columns || gridZ > rows) return outside?.(x, z);
    const col = Math.min(Math.floor(gridX), columns - 1);
    const row = Math.min(Math.floor(gridZ), rows - 1);
    const columnFraction = gridX - col, rowFraction = gridZ - row;
    const cornerIndex = row * (columns + 1) + col;
    const farLeft = positions.getY(cornerIndex + columns + 1);
    const nearRight = positions.getY(cornerIndex + 1);
    if (columnFraction + rowFraction <= 1) {
      const nearLeft = positions.getY(cornerIndex);
      return nearLeft + (nearRight - nearLeft) * columnFraction + (farLeft - nearLeft) * rowFraction;
    }
    const farRight = positions.getY(cornerIndex + columns + 2);
    return farRight + (farLeft - farRight) * (1 - columnFraction) + (nearRight - farRight) * (1 - rowFraction);
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
  for (let patchRow = row; patchRow < row + cells; patchRow++) {
    const start = (patchRow * columns + col) * 6;
    base.index.array.fill(0, start, start + cells * 6);
  }
  base.index.needsUpdate = true;
  return sample;
}

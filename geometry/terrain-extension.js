// Concentric square rings for extending a regular XZ heightfield. Row zero of the
// source grid runs east along its minimum Z. All returned buffers are transferable.
export function terrainExtension({ centerX = 0, centerZ = 0, size, segments, reach, growth = 1.3 }) {
  const half = size / 2;
  if (![centerX, centerZ, size, reach, growth].every(Number.isFinite)
    || size <= 0 || !Number.isSafeInteger(segments) || segments < 1 || reach <= half || growth <= 1) {
    throw new RangeError('Expected a square grid, a reach beyond its edge and growth greater than one');
  }
  const rows = Math.ceil(Math.log(reach / half) / Math.log(growth));
  const perimeter = 4 * segments;
  const vertices = perimeter * (rows + 1);
  const positions = new Float32Array(vertices * 3);
  const Index = vertices > 65535 ? Uint32Array : Uint16Array;
  const indices = new Index(perimeter * rows * 6);
  const boundary = new Uint32Array(perimeter);
  for (let ring = 0; ring <= rows; ring++) {
    const radius = half * growth ** ring;
    for (let perimeterIndex = 0; perimeterIndex < perimeter; perimeterIndex++) {
      const side = Math.floor(perimeterIndex / segments);
      const along = perimeterIndex % segments;
      let col = along, row = 0;
      switch (side) {
        case 1: col = segments; row = along; break;
        case 2: col = segments - along; row = segments; break;
        case 3: col = 0; row = segments - along; break;
      }
      if (ring === 0) boundary[perimeterIndex] = row * (segments + 1) + col;
      const vertex = ring * perimeter + perimeterIndex;
      const axis = -radius + 2 * radius * along / segments;
      positions[3 * vertex] = centerX + (side === 0 ? axis : side === 1 ? radius : side === 2 ? -axis : -radius);
      positions[3 * vertex + 2] = centerZ + (side === 0 ? -radius : side === 1 ? axis : side === 2 ? radius : -axis);
      if (ring === rows) continue;
      const next = ring * perimeter + (perimeterIndex + 1) % perimeter;
      const offset = 6 * vertex;
      indices[offset] = vertex;
      indices[offset + 1] = next;
      indices[offset + 2] = next + perimeter;
      indices[offset + 3] = vertex;
      indices[offset + 4] = next + perimeter;
      indices[offset + 5] = vertex + perimeter;
    }
  }
  return { positions, indices, boundary };
}

// For opaque, independently owned instance attributes. Logical ids remain stable while
// visible records occupy the front of the arrays. The original full bounds stay valid.
export function createInstanceVisibility(mesh) {
  const slots = Uint32Array.from({ length: mesh.count }, (_, i) => i);
  const ids = slots.slice();
  const attributes = [mesh.instanceMatrix];
  if (mesh.instanceColor) attributes.push(mesh.instanceColor);
  if (!mesh.boundingSphere) mesh.computeBoundingSphere();
  return function show(id, visible) {
    if (!Number.isInteger(id) || id < 0 || id >= ids.length) throw new RangeError('Unknown instance id');
    const from = slots[id];
    if (from < mesh.count === visible) return;
    const to = visible ? mesh.count++ : --mesh.count;
    if (from === to) return;
    const other = ids[to];
    ids[from] = other;
    slots[other] = from;
    ids[to] = id;
    slots[id] = to;
    for (const attribute of attributes) {
      const { array, itemSize } = attribute;
      const a = from * itemSize,
        b = to * itemSize;
      for (let i = 0; i < itemSize; i++) {
        const value = array[a + i];
        array[a + i] = array[b + i];
        array[b + i] = value;
      }
      // Include the hidden slot: it can become visible by growing count without another swap.
      const start = Math.min(a, b),
        end = Math.max(a, b) + itemSize;
      const range = attribute.updateRanges[0];
      if (range) {
        const limit = Math.max(end, range.start + range.count);
        range.start = Math.min(start, range.start);
        range.count = limit - range.start;
      } else attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
    }
  };
}

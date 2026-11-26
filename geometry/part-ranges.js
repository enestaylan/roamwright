// Concatenate matching attribute records in order. Each [parts, from, to] range uses
// offsets in the three-component position array. Other attribute strides are inferred.
export function joinParts(pieces) {
  if (!pieces.length) return {};
  const vertices = pieces.reduce((sum, [, from, to]) => sum + (to - from) / 3, 0),
    [sample] = pieces.find(([parts]) => parts.position.length) ?? pieces[0],
    joined = {};
  for (const name in sample) {
    const size = vertices && sample[name].length / (sample.position.length / 3),
      array = (joined[name] = new sample[name].constructor(vertices * size));
    let writeOffset = 0;
    for (const [parts, from, to] of pieces) {
      array.set(parts[name].subarray((from / 3) * size, (to / 3) * size), writeOffset);
      writeOffset += ((to - from) / 3) * size;
    }
  }
  return joined;
}

/**
 * Insert separately built pieces into parallel geometry batches (for example, one per material).
 * Each row of insertAt gives the offsets in the base batches where one piece belongs. The
 * corresponding row of ends gives its exclusive ends in the added batches. Offsets count
 * position components, as in joinParts. Rows are in insertion order and may repeat.
 * A missing insertion row means the start of every batch. A null base batch is skipped.
 * Use non-indexed vertex attributes with matching names, types and strides on both sides.
 * Inputs retain ownership of their arrays. A batch with data on only one side reuses that side.
 * @param {Array} base - Attribute records or null for excluded batches.
 * @param {Array} added - Attribute records in the same batch order and layout.
 * @param {Array} insertAt - One row per insertion.
 * @param {Array} ends - Cumulative end offsets for the added pieces.
 * @returns {Array} Attribute records in the original batch order.
 */
export function insertPartGroups(base, added, insertAt, ends) {
  return base.map((parts, group) => {
    if (!parts || !added[group].position.length) return parts;
    if (!parts.position.length) return added[group];
    if (parts.index || added[group].index) throw new TypeError('Mixed geometry batches must be non-indexed');
    const pieces = [];
    let baseStart = 0, addedStart = 0;
    for (let i = 0; i < ends.length; i++) {
      const at = insertAt[i]?.[group] ?? 0;
      const end = ends[i][group];
      if (at > baseStart) pieces.push([parts, baseStart, at]);
      if (end > addedStart) pieces.push([added[group], addedStart, end]);
      baseStart = at;
      addedStart = end;
    }
    if (baseStart < parts.position.length) pieces.push([parts, baseStart, parts.position.length]);
    return joinParts(pieces);
  });
}

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
    let at = 0;
    for (const [parts, from, to] of pieces) {
      array.set(parts[name].subarray((from / 3) * size, (to / 3) * size), at);
      at += ((to - from) / 3) * size;
    }
  }
  return joined;
}

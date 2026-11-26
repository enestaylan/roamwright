/**
 * Collect line segments for feature outlines and the subset that supports a surface
 * highlight. Both maps are keyed by caller IDs. Each value is a flat array of
 * segment endpoints [ax, ay, az, bx, by, bz, ...] in the caller's coordinate frame.
 * Each recorder has independent state, suitable for building on a page or a worker.
 * @param {number} ringSegments - Straight edges around a circular outline.
 */
export function createOutlineRecorder(ringSegments = 32) {
  if (!Number.isInteger(ringSegments) || ringSegments < 3) throw new RangeError('A ring needs at least three segments');
  const outlines = new Map(), shines = new Map();

  function segmentsFor(map, id) {
    let segments = map.get(id);
    if (!segments) map.set(id, segments = []);
    return segments;
  }

  /** Append an open path of [x, y, z] points. Repeat its first point to close it.
   * Pass false to omit this path from the surface highlight. */
  function path(id, points, shine = true) {
    const edges = segmentsFor(outlines, id);
    const highlighted = shine ? segmentsFor(shines, id) : null;
    for (let i = 1; i < points.length; i++) {
      edges.push(...points[i - 1], ...points[i]);
      if (highlighted) highlighted.push(...points[i - 1], ...points[i]);
    }
  }

  /** Append a horizontal ring starting at +X and turning toward +Z. */
  function ring(id, x, y, z, radius, shine = true) {
    const points = [];
    for (let i = 0; i <= ringSegments; i++) {
      const angle = (i / ringSegments) * 2 * Math.PI;
      points.push([x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius]);
    }
    path(id, points, shine);
  }

  /** Append a rectangle at each supplied height, using half-extents and a yaw in radians. */
  function rectangle(id, x, z, halfX, halfZ, heights, yaw = 0, shine = true) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const corner = (u, v, y) => [x + u * cos + v * sin, y, z - u * sin + v * cos];
    for (const y of heights) {
      const first = corner(-halfX, -halfZ, y);
      path(id, [first, corner(halfX, -halfZ, y), corner(halfX, halfZ, y), corner(-halfX, halfZ, y), first], shine);
    }
  }

  /** Return ordered [id, segments] pairs in each channel, suitable for postMessage.
   * The returned arrays belong to the caller. Existing references to the maps stay live. */
  function drain() {
    const record = { outlines: [...outlines], shines: [...shines] };
    outlines.clear();
    shines.clear();
    return record;
  }

  /** Append a drained record without modifying or retaining its segment arrays. */
  function merge(record) {
    for (const [map, entries] of [[outlines, record.outlines], [shines, record.shines]]) {
      for (const [id, segments] of entries) {
        const dest = segmentsFor(map, id);
        for (let i = 0; i < segments.length; i++) dest.push(segments[i]);
      }
    }
  }

  return { outlines, shines, path, ring, rectangle, drain, merge };
}

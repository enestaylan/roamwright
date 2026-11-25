import { HAIR_NEAR, STRANDS } from './hair-tags.js';

const POINT = 10, // numbers to a point: its place, its normal, its colour, and how far across the strands it lies
  BAND = 2 * STRANDS.period,
  MARGIN = 0.2, //  where a band's middle lies within the tag's fraction: a triangle may reach this far out of its band
  MOST = 0.97; //   the most of the fraction a tag carries

// Emit each shared vertex once per strand band, correcting the winding from the supplied normals.
function packHairPatch(points, triangles, emitVertex) {
  const bands = new Map(), corners = [];
  let vertexCount = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * POINT,
      b = triangles[t + 1] * POINT,
      c = triangles[t + 2] * POINT,
      band = Math.floor((points[a + 9] + points[b + 9] + points[c + 9]) / 3 / BAND),
      ux = points[b] - points[a],
      uy = points[b + 1] - points[a + 1],
      uz = points[b + 2] - points[a + 2],
      vx = points[c] - points[a],
      vy = points[c + 1] - points[a + 1],
      vz = points[c + 2] - points[a + 2],
      faces =
        (uy * vz - uz * vy) * (points[a + 3] + points[b + 3] + points[c + 3]) +
        (uz * vx - ux * vz) * (points[a + 4] + points[b + 4] + points[c + 4]) +
        (ux * vy - uy * vx) * (points[a + 5] + points[b + 5] + points[c + 5]);
    let put = bands.get(band);
    if (!put) { put = new Map(); bands.set(band, put); }
    for (const p of faces < 0 ? [a, c, b] : [a, b, c]) {
      let v = put.get(p);
      if (v === undefined) {
        v = vertexCount++;
        put.set(p, v);
        const tag = HAIR_NEAR + Math.min(MOST, Math.max(0, points[p + 9] - band * BAND + MARGIN));
        emitVertex(p, tag);
      }
      corners.push(v);
    }
  }
  return corners;
}
export { POINT, packHairPatch };

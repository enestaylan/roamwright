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
    const firstOffset = triangles[t] * POINT,
      secondOffset = triangles[t + 1] * POINT,
      thirdOffset = triangles[t + 2] * POINT,
      band = Math.floor((points[firstOffset + 9] + points[secondOffset + 9] + points[thirdOffset + 9]) / 3 / BAND),
      ux = points[secondOffset] - points[firstOffset],
      uy = points[secondOffset + 1] - points[firstOffset + 1],
      uz = points[secondOffset + 2] - points[firstOffset + 2],
      vx = points[thirdOffset] - points[firstOffset],
      vy = points[thirdOffset + 1] - points[firstOffset + 1],
      vz = points[thirdOffset + 2] - points[firstOffset + 2],
      faces =
        (uy * vz - uz * vy) * (points[firstOffset + 3] + points[secondOffset + 3] + points[thirdOffset + 3]) +
        (uz * vx - ux * vz) * (points[firstOffset + 4] + points[secondOffset + 4] + points[thirdOffset + 4]) +
        (ux * vy - uy * vx) * (points[firstOffset + 5] + points[secondOffset + 5] + points[thirdOffset + 5]);
    let put = bands.get(band);
    if (!put) { put = new Map(); bands.set(band, put); }
    for (const pointOffset of faces < 0 ? [firstOffset, thirdOffset, secondOffset] : [firstOffset, secondOffset, thirdOffset]) {
      let v = put.get(pointOffset);
      if (v === undefined) {
        v = vertexCount++;
        put.set(pointOffset, v);
        const tag = HAIR_NEAR + Math.min(MOST, Math.max(0, points[pointOffset + 9] - band * BAND + MARGIN));
        emitVertex(pointOffset, tag);
      }
      corners.push(v);
    }
  }
  return corners;
}
export { POINT, packHairPatch };

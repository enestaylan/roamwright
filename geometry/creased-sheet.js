import { sstep } from '../math/scalar.js';

/**
 * `creasedSheet(builder, rows, colors, options)` triangulates a rectangular grid of XYZ points with matching linear
 * RGB triples. Corner normals are area weighted over adjoining faces whose cosine is at least `crease` (default −1).
 * Pass `wrap` for a closed column seam, `inside` to reverse winding, and `tint, slopeFrom, slopeTo` for optional
 * upward-facing color. Degenerate triangles emit no vertices.
 */
export function creasedSheet(
  builder,
  rows,
  tones,
  { wrap = false, inside = false, crease = -1, tint = null, slopeFrom = 0, slopeTo = 1 } = {},
) {
  if (rows.length < 2 || rows[0].length < 2) return;
  const rowSegments = rows.length - 1,
    cols = rows[0].length,
    columnSegments = wrap ? cols : cols - 1,
    faces = new Float64Array(rowSegments * columnSegments * 6), // each cell's two triangles' normals, as long as twice their areas
    side = inside ? -1 : 1,
    next = i => (wrap && i === cols - 1 ? 0 : i + 1);
  const cross = (output, pointA, pointB, pointC, at) => {
    const ux = pointB[0] - pointA[0],
      uy = pointB[1] - pointA[1],
      uz = pointB[2] - pointA[2],
      vx = pointC[0] - pointA[0],
      vy = pointC[1] - pointA[1],
      vz = pointC[2] - pointA[2];
    output[at] = (uy * vz - uz * vy) * side;
    output[at + 1] = (uz * vx - ux * vz) * side;
    output[at + 2] = (ux * vy - uy * vx) * side;
  };
  for (let j = 0; j < rowSegments; j++)
    for (let i = 0; i < columnSegments; i++) {
      const topLeft = rows[j][i],
        topRight = rows[j][next(i)],
        bottomRight = rows[j + 1][next(i)],
        bottomLeft = rows[j + 1][i],
        at = (j * columnSegments + i) * 6;
      cross(faces, topLeft, topRight, bottomRight, at);
      cross(faces, topLeft, bottomRight, bottomLeft, at + 3);
    }
  const length = at => Math.hypot(faces[at], faces[at + 1], faces[at + 2]);
  // The normal at point (j, i) for the triangle whose normal starts at `own` in faces: the triangles round the point that lie
  // within the crease of it, summed by their areas.
  const normal = [0, 0, 0],
    pointNormal = (j, i, own) => {
      const ol = length(own) || 1;
      normal[0] = normal[1] = normal[2] = 0;
      for (let qj = j - 1; qj <= j; qj++) {
        if (qj < 0 || qj >= rowSegments) continue;
        for (let s = -1; s <= 0; s++) {
          let qi = i + s;
          if (qi < 0) {
            if (!wrap) continue;
            qi += cols;
          }
          if (qi >= columnSegments) continue;
          // The top-right corner belongs only to the first triangle, the bottom-left only to the second.
          const lower = qj === j,
            left = qi === i,
            isB = lower && !left,
            isD = !lower && left;
          for (let t = 0; t < 2; t++) {
            if ((t === 0 && isD) || (t === 1 && isB)) continue;
            const at = (qj * columnSegments + qi) * 6 + t * 3,
              l = length(at);
            if (l < 1e-12) continue;
            if ((faces[at] * faces[own] + faces[at + 1] * faces[own + 1] + faces[at + 2] * faces[own + 2]) / (l * ol) < crease) continue;
            normal[0] += faces[at];
            normal[1] += faces[at + 1];
            normal[2] += faces[at + 2];
          }
        }
      }
      const l = Math.hypot(normal[0], normal[1], normal[2]);
      if (l < 1e-12) {
        normal[0] = faces[own] / ol;
        normal[1] = faces[own + 1] / ol;
        normal[2] = faces[own + 2] / ol;
      } else for (let k = 0; k < 3; k++) normal[k] /= l;
      return normal;
    };
  const corner = (j, i, own) => {
    const point = rows[j][i],
      n = pointNormal(j, i, own),
      tone = tones[j][i],
      lay = tint ? sstep(slopeFrom, slopeTo, n[1]) : 0;
    builder.raw(
      point[0],
      point[1],
      point[2],
      n[0],
      n[1],
      n[2],
      tone[0] + (tint ? (tint[0] - tone[0]) * lay : 0),
      tone[1] + (tint ? (tint[1] - tone[1]) * lay : 0),
      tone[2] + (tint ? (tint[2] - tone[2]) * lay : 0),
    );
  };
  for (let j = 0; j < rowSegments; j++)
    for (let i = 0; i < columnSegments; i++) {
      const at = (j * columnSegments + i) * 6,
        i1 = next(i);
      // Both triangles share the top-left to bottom-right diagonal. Reverse their winding for an inside surface.
      if (length(at) > 1e-12) {
        corner(j, i, at);
        if (inside) {
          corner(j + 1, i1, at);
          corner(j, i1, at);
        } else {
          corner(j, i1, at);
          corner(j + 1, i1, at);
        }
      }
      if (length(at + 3) > 1e-12) {
        corner(j, i, at + 3);
        if (inside) {
          corner(j + 1, i, at + 3);
          corner(j + 1, i1, at + 3);
        } else {
          corner(j + 1, i1, at + 3);
          corner(j + 1, i, at + 3);
        }
      }
    }
}

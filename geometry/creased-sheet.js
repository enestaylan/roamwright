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
  const nv = rows.length - 1,
    cols = rows[0].length,
    nu = wrap ? cols : cols - 1,
    faces = new Float64Array(nv * nu * 6), // each cell's two triangles' normals, as long as twice their areas
    side = inside ? -1 : 1,
    next = i => (wrap && i === cols - 1 ? 0 : i + 1);
  const cross = (o, a, b, c, at) => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    o[at] = (uy * vz - uz * vy) * side;
    o[at + 1] = (uz * vx - ux * vz) * side;
    o[at + 2] = (ux * vy - uy * vx) * side;
  };
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = rows[j][i],
        b = rows[j][next(i)],
        c = rows[j + 1][next(i)],
        d = rows[j + 1][i],
        at = (j * nu + i) * 6;
      cross(faces, a, b, c, at);
      cross(faces, a, c, d, at + 3);
    }
  const length = at => Math.hypot(faces[at], faces[at + 1], faces[at + 2]);
  // The normal at point (j, i) for the triangle whose normal starts at `own` in faces: the triangles round the point that lie
  // within the crease of it, summed by their areas.
  const normal = [0, 0, 0],
    pointNormal = (j, i, own) => {
      const ol = length(own) || 1;
      normal[0] = normal[1] = normal[2] = 0;
      for (let qj = j - 1; qj <= j; qj++) {
        if (qj < 0 || qj >= nv) continue;
        for (let s = -1; s <= 0; s++) {
          let qi = i + s;
          if (qi < 0) {
            if (!wrap) continue;
            qi += cols;
          }
          if (qi >= nu) continue;
          // which of the cell's two triangles (a b c and a c d) have this point as a corner: b is in the first only, d in the second
          const lower = qj === j,
            left = qi === i,
            isB = lower && !left,
            isD = !lower && left;
          for (let t = 0; t < 2; t++) {
            if ((t === 0 && isD) || (t === 1 && isB)) continue;
            const at = (qj * nu + qi) * 6 + t * 3,
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
    const p = rows[j][i],
      n = pointNormal(j, i, own),
      tone = tones[j][i],
      lay = tint ? sstep(slopeFrom, slopeTo, n[1]) : 0;
    builder.raw(
      p[0],
      p[1],
      p[2],
      n[0],
      n[1],
      n[2],
      tone[0] + (tint ? (tint[0] - tone[0]) * lay : 0),
      tone[1] + (tint ? (tint[1] - tone[1]) * lay : 0),
      tone[2] + (tint ? (tint[2] - tone[2]) * lay : 0),
    );
  };
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const at = (j * nu + i) * 6,
        i1 = next(i);
      // a b c, then a c d; seen from inside, a c b and a d c
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

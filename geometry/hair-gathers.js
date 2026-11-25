import { lerp, sstep, TAU } from '../math/scalar.js';
import { STRANDS } from './hair-tags.js';
import { POINT } from './hair-patch.js';

const ROOT_SHADE = 0.72, // hair is darker where it is gathered or leaves the head than at its ends
  PLAIT_LEAN = 0.7, //    how far a plait's strands slant from its length (the tangent of the angle)
  PLAIT_SWELL = 0.26, //   how far each turn of a plait stands out of it, a share of its thickness
  PLAIT_ROWS = 4, //      rows of points to a turn of a plait: fewer, and its outline is a saw's
  SHUT = 0.12; //         a rope or a plait begins this much of its first ring's size, so that no open end shows

// A value at t along a row of spans' values (one for each ring), bent smoothly through them.
function through(rings, k, t) {
  const last = rings.length - 1,
    i = Math.min(last - 1, Math.floor(t)),
    f = t - i,
    a = rings[Math.max(0, i - 1)][k],
    b = rings[i][k],
    c = rings[i + 1][k],
    d = rings[Math.min(last, i + 2)][k];
  return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
}

// The ring a rope begins with, above its first: drawn in to a point.
const shut = ring => [ring[0] + ring[1] * 0.8, ring[1] * SHUT, ring[2] * SHUT, ring[3], ring[4]];

// Adds a surface that hangs, lofted down through rings [height, half-width, half-depth, middle across, middle fore and aft]:
// a rope where it goes all the way round, a sheet from o.a0 to o.a1 (angles as a loft counts them: 3/2 pi is straight behind).
// o: rows and sides (how finely it is cut), colour and tone(v, a) (how bright a point a share v of the way down is), swell(v, a,
// y) (its thickness there, of the rings'), hem(a) (how much lower its end hangs there, metres), lean (how far its strands slant:
// the way across them goes so much round for each metre down), from (the strand its first side lies at), root (how dark it is
// where it begins, if not as dark as hair that is gathered).
function hang(patch, rings, o) {
  const open = o.a1 !== undefined;
  if (!open) rings = [shut(rings[0]), ...rings];
  const { rows, sides, colour } = o,
    a0 = o.a0 ?? 0,
    a1 = o.a1 ?? TAU,
    first = patch.points.length / POINT,
    spans = rings.length - 1,
    at = (i, j) => first + i * (sides + 1) + j,
    place = [],
    mean = rings.reduce((sum, r) => sum + (r[1] + r[2]) / 2, 0) / rings.length,
    // a rope's strands meet themselves again once round it: a whole number of periods to the turn
    round = open
      ? (mean * (a1 - a0)) / STRANDS.span
      : Math.max(1, Math.round((mean * TAU) / STRANDS.span / STRANDS.period)) * STRANDS.period;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows,
      t = v * spans;
    for (let j = 0; j <= sides; j++) {
      const a = a0 + ((a1 - a0) * j) / sides,
        y = through(rings, 0, t) - (o.hem ? o.hem(a) * v * v : 0),
        k = o.swell ? o.swell(v, a, y) : 1;
      place.push(
        through(rings, 3, t) + Math.cos(a) * through(rings, 1, t) * k,
        y,
        through(rings, 4, t) + Math.sin(a) * through(rings, 2, t) * k,
      );
    }
  }
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= sides; j++) {
      // the normal from the points round about (a rope's first and last sides are one line)
      const wrap = j2 => (open ? Math.min(sides, Math.max(0, j2)) : (j2 + sides) % sides),
        l = (i * (sides + 1) + wrap(j - 1)) * 3,
        r = (i * (sides + 1) + wrap(j + 1)) * 3,
        up = (Math.max(0, i - 1) * (sides + 1) + j) * 3,
        down = (Math.min(rows, i + 1) * (sides + 1) + j) * 3,
        p = (i * (sides + 1) + j) * 3,
        a = a0 + ((a1 - a0) * j) / sides,
        v = i / rows,
        tx = place[r] - place[l],
        ty = place[r + 1] - place[l + 1],
        tz = place[r + 2] - place[l + 2],
        ux = place[down] - place[up],
        uy = place[down + 1] - place[up + 1],
        uz = place[down + 2] - place[up + 2];
      let nx = ty * uz - tz * uy,
        ny = tz * ux - tx * uz,
        nz = tx * uy - ty * ux;
      const length = Math.hypot(nx, ny, nz) || 1,
        out = nx * Math.cos(a) + nz * Math.sin(a) < 0 ? -1 : 1,
        tone = (o.tone ? o.tone(v, a) : 1) * lerp(o.root ?? ROOT_SHADE, 1, sstep(0, 0.35, v));
      nx *= out / length;
      ny *= out / length;
      nz *= out / length;
      patch.points.push(
        place[p],
        place[p + 1],
        place[p + 2],
        nx,
        ny,
        nz,
        colour[0] * tone,
        colour[1] * tone,
        colour[2] * tone,
        (o.from || 0) + (round * j) / sides + (o.lean || 0) * (rings[0][0] - place[p + 1]),
      );
      if (i < rows && j < sides) patch.triangles.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
}

// A plait hanging: two halves side by side, their strands slanting in to the line between them, each turn of the plait
// standing out on one side and then the other. turn: the height of one turn (metres); side: which way it faces (the angle of
// the line between its halves, as a loft counts angles).
function plait(patch, rings, o) {
  rings = [shut(rings[0]), ...rings];
  const turns = Math.max(1, Math.round((rings[0][0] - rings[rings.length - 1][0]) / o.turn)),
    rows = turns * PLAIT_ROWS;
  for (const half of [-1, 1])
    hang(patch, rings, {
      ...o,
      rows,
      sides: o.sides >> 1,
      a0: o.side + (half < 0 ? -Math.PI : 0),
      a1: o.side + (half < 0 ? 0 : Math.PI),
      lean: (half * PLAIT_LEAN) / STRANDS.span,
      from: (o.from || 0) + half,
      swell: (v, a) => 1 + PLAIT_SWELL * half * Math.cos(v * turns * TAU) * Math.sin(Math.abs(a - o.side)) * sstep(0, 0.06, v),
      tone: (v, a) => 0.72 + 0.28 * Math.sin(Math.abs(a - o.side)),
    });
}

// A knot of hair on the head: a ball at `at` with half-sizes `size` (from the head's middle), its strands wound round its
// upright axis and climbing a little as they go.
function knot(patch, place, at, size, colour, rows, sides) {
  const first = patch.points.length / POINT,
    round = Math.max(1, Math.round((((size[0] + size[2]) / 2) * TAU) / STRANDS.span / STRANDS.period)) * STRANDS.period;
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= sides; j++) {
      const polar = (i / rows) * Math.PI,
        a = (j / sides) * TAU,
        nx = Math.sin(polar) * Math.cos(a),
        ny = Math.cos(polar),
        nz = Math.sin(polar) * Math.sin(a),
        tone = 0.8 + 0.2 * ny,
        v = place([at[0] + nx * size[0], at[1] + ny * size[1], at[2] + nz * size[2], nx / size[0], ny / size[1], nz / size[2]]);
      patch.points.push(
        v[0],
        v[1],
        v[2],
        v[3],
        v[4],
        v[5],
        colour[0] * tone,
        colour[1] * tone,
        colour[2] * tone,
        (round * j) / sides + 0.35 * (i / rows),
      );
      if (i < rows && j < sides) {
        const p = first + i * (sides + 1) + j;
        patch.triangles.push(p, p + sides + 1, p + sides + 2, p, p + sides + 2, p + 1);
      }
    }
}

// The fall of long hair down the back as a near head wears it: the far fall's rings (hair-far.js, fallShape: [height, half-
// width, half-depth, middle]), but beginning on the mass of the hair itself, where the long locks leave the head, instead of
// standing off it. crown: the ring of the mass there. Returns the rings, and at(y): the fall's half-width, half-depth and
// middle at a height.
function nearFallRings(rings, crown) {
  const fallen = [crown, ...rings.slice(1)],
    at = y => {
      let i = 0;
      while (i < fallen.length - 2 && y < fallen[i + 1][0]) i++;
      const a = fallen[i],
        b = fallen[i + 1],
        t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    };
  return { rings: fallen, at };
}

export { hang, knot, nearFallRings, plait };

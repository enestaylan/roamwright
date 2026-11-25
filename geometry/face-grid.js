import { Vector3 } from 'three';

// ════════════════════════════════════════════════════════════════════════
//  The grid a head is sculpted on: rows by height and columns by angle round from the front, crowded where a face needs them
//  (the lids, the nose, the lips). Behind the face only some of the rows go on, joined to the rest without a gap.
// ════════════════════════════════════════════════════════════════════════
const HALF = 118, // millimetres from the head's middle to its crown: the rows are given in millimetres
  CHANNELS = 8,
  EYE_WIDTH = 74.5, // half the head's width at the eyes and how square its outline is there: columns are given by how far
  EYE_SQUARE = 2.15; //   across the face they cross that level

// The angle round from the front at which the outline at the eyes' level is that far across.
function angleAcross(across) {
  let low = 0,
    high = Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const a = (low + high) / 2,
      s = Math.sin(a),
      c = Math.cos(a);
    if (EYE_WIDTH * s * Math.pow(Math.pow(s, EYE_SQUARE) + Math.pow(c, EYE_SQUARE), -1 / EYE_SQUARE) < across) low = a;
    else high = a;
  }
  return (low + high) / 2;
}

// rows: heights from the chin up; across: columns over the face (millimetres at the eyes' level); behind: columns round the back
// (degrees); backRows: the rows that go on behind the face (all of them if none are named); closed: whether the grid closes
// over the crown and under the chin.
function faceGrid(rows, across, behind, backRows, closed = true) {
  const half = [...across.map(angleAcross), ...behind.map(deg => (deg * Math.PI) / 180)],
    angles = [
      ...half
        .slice(1)
        .reverse()
        .map(a => -a),
      ...half,
    ],
    nr = rows.length,
    nc = angles.length,
    faceEdge = half[across.length - 1] + 1e-6,
    whole = angles.map(a => Math.abs(a) <= faceEdge), // the columns that carry every row
    kept = rows.map((y, i) => (!backRows || i === 0 || i === nr - 1 || backRows.includes(y) ? i : -1)).filter(i => i >= 0),
    used = new Uint8Array(nr * nc),
    idx = [];
  for (let j = 0; j < nc; j++) for (let i = 0; i < nr; i++) used[i * nc + j] = whole[j] || kept.includes(i) ? 1 : 0;
  for (let j = 0; j < nc - 1; j++) {
    const left = (i, c = j) => i * nc + c,
      right = i => i * nc + j + 1;
    if (whole[j] && whole[j + 1])
      for (let i = 0; i < nr - 1; i++) idx.push(left(i), right(i), right(i + 1), left(i), right(i + 1), left(i + 1));
    else
      for (let k = 0; k < kept.length - 1; k++) {
        const a = kept[k],
          b = kept[k + 1],
          mid = (a + b + 1) >> 1;
        if (!whole[j] && !whole[j + 1]) idx.push(left(a), right(a), right(b), left(a), right(b), left(b));
        else if (whole[j]) {
          // every row on the left, the kept ones on the right: a fan from each end of the right-hand edge
          for (let i = a; i < b; i++) idx.push(left(i), right(i < mid ? a : b), left(i + 1));
          idx.push(left(mid), right(a), right(b));
        } else {
          for (let i = a; i < b; i++) idx.push(left(i < mid ? a : b), right(i), right(i + 1));
          idx.push(left(a), right(mid), left(b));
        }
      }
  }
  if (closed) for (let j = 0; j < nc - 1; j++) idx.push((nr - 1) * nc + j, (nr - 1) * nc + j + 1, nr * nc, j + 1, j, nr * nc + 1);
  return { rows, angles, nr, nc, used, idx };
}

const _o = new Vector3(),
  _a = new Vector3(),
  _b = new Vector3(),
  _ch = [0, 1, 0, 0, 0, 0, 0, 0];

// A head function sampled on a grid: positions, normals, the channels of each point, and the grid's triangles.
function faceSculpt(fn, grid) {
  const { rows, angles, nr, nc, used, idx } = grid,
    n = nr * nc + 2,
    P = new Float32Array(n * 3),
    N = new Float32Array(n * 3),
    CH = new Float32Array(n * CHANNELS);
  const put = (i, row, angle) => {
    fn.point(row, angle, _o, _ch);
    P[i * 3] = _o.x;
    P[i * 3 + 1] = _o.y;
    P[i * 3 + 2] = _o.z;
    for (let k = 0; k < CHANNELS; k++) CH[i * CHANNELS + k] = _ch[k];
  };
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (used[i * nc + j]) put(i * nc + j, rows[i], angles[j]);
  put(nr * nc, HALF, 0);
  put(nr * nc + 1, -HALF, 0);
  // each point's normal is the sum of its triangles', so a row pinched shut at the corner of an eye does no harm
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3,
      b = idx[t + 1] * 3,
      c = idx[t + 2] * 3;
    _a.set(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
    _b.set(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]);
    _a.cross(_b);
    for (const q of [a, b, c]) {
      N[q] += _a.x;
      N[q + 1] += _a.y;
      N[q + 2] += _a.z;
    }
  }
  for (let i = 0; i < nr; i++) {
    // the first and last columns are one line down the back of the head
    const a = i * nc * 3,
      b = (i * nc + nc - 1) * 3;
    for (let k = 0; k < 3; k++) N[a + k] = N[b + k] = N[a + k] + N[b + k];
  }
  for (let i = 0; i < n; i++) {
    const q = i * 3,
      l = Math.hypot(N[q], N[q + 1], N[q + 2]);
    if (l > 0) {
      N[q] /= l;
      N[q + 1] /= l;
      N[q + 2] /= l;
    } else N[q + 1] = 1;
  }
  return { P, N, CH, idx };
}

// The point of the face that lies at x across and y up from the head's middle (metres), as [x, y, z, and the normal there],
// raised off the skin by lift.
function faceAt(fn, x, y, lift = 0) {
  let row = y * 1000,
    angle = Math.asin(Math.max(-0.99, Math.min(0.99, (x * 1000) / EYE_WIDTH)));
  for (let i = 0; i < 5; i++) {
    fn.point(row, angle, _o, null);
    row += (y - _o.y) * 1000;
    angle += ((x - _o.x) * 1000) / 70;
  }
  fn.point(row + 0.6, angle, _a, null);
  fn.point(row, angle + 0.012, _b, null);
  _a.sub(_o);
  _b.sub(_o);
  _b.cross(_a).normalize();
  return [_o.x + _b.x * lift, _o.y + _b.y * lift, _o.z + _b.z * lift, _b.x, _b.y, _b.z];
}

export { CHANNELS, faceAt, faceGrid, faceSculpt };

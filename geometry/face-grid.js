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
    const angle = (low + high) / 2,
      s = Math.sin(angle),
      c = Math.cos(angle);
    if (EYE_WIDTH * s * Math.pow(Math.pow(s, EYE_SQUARE) + Math.pow(c, EYE_SQUARE), -1 / EYE_SQUARE) < across) low = angle;
    else high = angle;
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
        .map(angle => -angle),
      ...half,
    ],
    rowCount = rows.length,
    columnCount = angles.length,
    faceEdge = half[across.length - 1] + 1e-6,
    whole = angles.map(angle => Math.abs(angle) <= faceEdge), // the columns that carry every row
    kept = rows.map((y, i) => (!backRows || i === 0 || i === rowCount - 1 || backRows.includes(y) ? i : -1)).filter(i => i >= 0),
    used = new Uint8Array(rowCount * columnCount),
    indices = [];
  for (let j = 0; j < columnCount; j++) for (let i = 0; i < rowCount; i++) used[i * columnCount + j] = whole[j] || kept.includes(i) ? 1 : 0;
  for (let j = 0; j < columnCount - 1; j++) {
    const left = (i, column = j) => i * columnCount + column,
      right = i => i * columnCount + j + 1;
    if (whole[j] && whole[j + 1])
      for (let i = 0; i < rowCount - 1; i++) indices.push(left(i), right(i), right(i + 1), left(i), right(i + 1), left(i + 1));
    else
      for (let k = 0; k < kept.length - 1; k++) {
        const currentRow = kept[k],
          nextRow = kept[k + 1],
          mid = (currentRow + nextRow + 1) >> 1;
        if (!whole[j] && !whole[j + 1]) indices.push(left(currentRow), right(currentRow), right(nextRow), left(currentRow), right(nextRow), left(nextRow));
        else if (whole[j]) {
          // every row on the left, the kept ones on the right: a fan from each end of the right-hand edge
          for (let i = currentRow; i < nextRow; i++) indices.push(left(i), right(i < mid ? currentRow : nextRow), left(i + 1));
          indices.push(left(mid), right(currentRow), right(nextRow));
        } else {
          for (let i = currentRow; i < nextRow; i++) indices.push(left(i < mid ? currentRow : nextRow), right(i), right(i + 1));
          indices.push(left(currentRow), right(mid), left(nextRow));
        }
      }
  }
  if (closed) for (let j = 0; j < columnCount - 1; j++) indices.push((rowCount - 1) * columnCount + j, (rowCount - 1) * columnCount + j + 1, rowCount * columnCount, j + 1, j, rowCount * columnCount + 1);
  return { rows, angles, nr: rowCount, nc: columnCount, used, idx: indices };
}

const _o = new Vector3(),
  _a = new Vector3(),
  _b = new Vector3(),
  _ch = [0, 1, 0, 0, 0, 0, 0, 0];

// A head function sampled on a grid: positions, normals, the channels of each point, and the grid's triangles.
function faceSculpt(sampleFace, grid) {
  const { rows, angles, nr: rowCount, nc: columnCount, used, idx: indices } = grid,
    n = rowCount * columnCount + 2,
    positions = new Float32Array(n * 3),
    normals = new Float32Array(n * 3),
    channels = new Float32Array(n * CHANNELS);
  const put = (i, row, angle) => {
    sampleFace.point(row, angle, _o, _ch);
    positions[i * 3] = _o.x;
    positions[i * 3 + 1] = _o.y;
    positions[i * 3 + 2] = _o.z;
    for (let k = 0; k < CHANNELS; k++) channels[i * CHANNELS + k] = _ch[k];
  };
  for (let i = 0; i < rowCount; i++) for (let j = 0; j < columnCount; j++) if (used[i * columnCount + j]) put(i * columnCount + j, rows[i], angles[j]);
  put(rowCount * columnCount, HALF, 0);
  put(rowCount * columnCount + 1, -HALF, 0);
  // each point's normal is the sum of its triangles', so a row pinched shut at the corner of an eye does no harm
  for (let t = 0; t < indices.length; t += 3) {
    const firstOffset = indices[t] * 3,
      secondOffset = indices[t + 1] * 3,
      thirdOffset = indices[t + 2] * 3;
    _a.set(positions[secondOffset] - positions[firstOffset], positions[secondOffset + 1] - positions[firstOffset + 1], positions[secondOffset + 2] - positions[firstOffset + 2]);
    _b.set(positions[thirdOffset] - positions[firstOffset], positions[thirdOffset + 1] - positions[firstOffset + 1], positions[thirdOffset + 2] - positions[firstOffset + 2]);
    _a.cross(_b);
    for (const q of [firstOffset, secondOffset, thirdOffset]) {
      normals[q] += _a.x;
      normals[q + 1] += _a.y;
      normals[q + 2] += _a.z;
    }
  }
  for (let i = 0; i < rowCount; i++) {
    // the first and last columns are one line down the back of the head
    const firstColumnOffset = i * columnCount * 3,
      lastColumnOffset = (i * columnCount + columnCount - 1) * 3;
    for (let k = 0; k < 3; k++) normals[firstColumnOffset + k] = normals[lastColumnOffset + k] = normals[firstColumnOffset + k] + normals[lastColumnOffset + k];
  }
  for (let i = 0; i < n; i++) {
    const q = i * 3,
      l = Math.hypot(normals[q], normals[q + 1], normals[q + 2]);
    if (l > 0) {
      normals[q] /= l;
      normals[q + 1] /= l;
      normals[q + 2] /= l;
    } else normals[q + 1] = 1;
  }
  return { P: positions, N: normals, CH: channels, idx: indices };
}

// The point of the face that lies at x across and y up from the head's middle (metres), as [x, y, z, and the normal there],
// raised off the skin by lift.
function faceAt(sampleFace, x, y, lift = 0) {
  let row = y * 1000,
    angle = Math.asin(Math.max(-0.99, Math.min(0.99, (x * 1000) / EYE_WIDTH)));
  for (let i = 0; i < 5; i++) {
    sampleFace.point(row, angle, _o, null);
    row += (y - _o.y) * 1000;
    angle += ((x - _o.x) * 1000) / 70;
  }
  sampleFace.point(row + 0.6, angle, _a, null);
  sampleFace.point(row, angle + 0.012, _b, null);
  _a.sub(_o);
  _b.sub(_o);
  _b.cross(_a).normalize();
  return [_o.x + _b.x * lift, _o.y + _b.y * lift, _o.z + _b.z * lift, _b.x, _b.y, _b.z];
}

export { CHANNELS, faceAt, faceGrid, faceSculpt };

/**
 * Render a heightfield in chunks and change each chunk’s mesh resolution as the camera moves.
 * @module
 */

import * as THREE from 'three';
import { SRGB2LIN } from '../math/color.js';
import { clamp } from '../math/scalar.js';

const _normal = [0, 0, 0]; // scratch of buildChunkGeometry

// A land's normal at grid point k, into out: from its normals, or worked out (normalAt) by a land that has let them go.
function normalOf(land, k, out) {
  const n = land.normals;
  if (!n) return land.normalAt(k, out);
  out[0] = n[k * 3];
  out[1] = n[k * 3 + 1];
  out[2] = n[k * 3 + 2];
  return out;
}
// Sample one chunk's grid, with skirts below its edges to hide cracks between resolutions.
// A land may draw its mesh lower at some points (`sunkAt(k)`, metres), under an overlaid higher-resolution mesh.
function buildChunkGeometry(land, ci, cj, lod) {
  const { cells, stride, spacing, x0, z0, heights, colors, bedY, sunkAt } = land;
  const step = 1 << lod,
    n = cells / step,
    m = n + 3;
  const positions = new Float32Array(m * m * 3),
    normals = new Float32Array(m * m * 3),
    chunkColors = new Float32Array(m * m * 3),
    uv = new Float32Array(m * m * 2);
  let p = 0;
  for (let row = 0; row < m; row++) {
    const jj = clamp(row - 1, 0, n),
      sb = row === 0 || row === m - 1;
    for (let column = 0; column < m; column++, p++) {
      const ii = clamp(column - 1, 0, n),
        skirt = sb || column === 0 || column === m - 1;
      const gi = ci * cells + ii * step,
        gj = cj * cells + jj * step,
        k = gj * stride + gi;
      const x = x0 + gi * spacing,
        z = z0 + gj * spacing;
      positions[p * 3] = x;
      positions[p * 3 + 1] = heights[k] - (skirt ? 5 + 5 * lod : 0) - (sunkAt ? sunkAt(k) : 0);
      positions[p * 3 + 2] = z;
      normalOf(land, k, _normal);
      normals[p * 3] = _normal[0];
      normals[p * 3 + 1] = _normal[1];
      normals[p * 3 + 2] = _normal[2];
      chunkColors[p * 3] = SRGB2LIN[colors[k * 3]];
      chunkColors[p * 3 + 1] = SRGB2LIN[colors[k * 3 + 1]];
      chunkColors[p * 3 + 2] = SRGB2LIN[colors[k * 3 + 2]];
      uv[p * 2] = x / 9;
      uv[p * 2 + 1] = z / 9;
    }
  }
  return chunkGeometry(positions, normals, chunkColors, uv, m, bedY);
}
// A chunk's geometry from its m x m points: two triangles to a cell, the deep lake bed's (below bedY) in a group of their own.
function chunkGeometry(positions, normals, chunkColors, uv, m, bedY) {
  const Index = m * m > 65536 ? Uint32Array : Uint16Array;
  const indices = new Index((m - 1) * (m - 1) * 6);
  let q = 0,
    e = indices.length; // land from the front, deep lake bed (group 1, the plain bed material) from the back
  const deep = (i, j, k) => positions[i * 3 + 1] < bedY && positions[j * 3 + 1] < bedY && positions[k * 3 + 1] < bedY;
  const tri = (i, j, k) => {
    if (deep(i, j, k)) {
      indices[--e] = k;
      indices[--e] = j;
      indices[--e] = i;
    } else {
      indices[q++] = i;
      indices[q++] = j;
      indices[q++] = k;
    }
  };
  for (let row = 0; row < m - 1; row++)
    for (let column = 0; column < m - 1; column++) {
      const i00 = row * m + column,
        i10 = i00 + 1,
        i01 = i00 + m,
        i11 = i01 + 1;
      tri(i00, i01, i10);
      tri(i10, i01, i11);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(chunkColors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  if (bedY !== undefined) {
    // a chunk with no deep bed (or nothing but bed) has one group: an empty one would still be a draw call
    if (q) g.addGroup(0, q, 0);
    if (q < indices.length) g.addGroup(q, indices.length - q, 1);
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
// The finest level, drawn only near the viewer over a land with fine relief with a relief function: each cell of
// the grid split FINE times each way, the baked heights read as the coarser levels' triangles have them, the relief added, the
// colours read between the grid's points, and the normals the grid's own, tilted by the relief's slope.
const FINE = 3; // parts each cell is split into (3.9 m cells: 1.3 m between the fine level's points)
function buildFineGeometry(land, ci, cj) {
  const { cells, stride, spacing, x0, z0, heights, colors, bedY, relief } = land,
    n = cells * FINE,
    m = n + 3,
    step = spacing / FINE,
    last = stride - 1;
  // the heights and relief over the chunk and a ring round it (for the relief's slope at its edge): r = n + 3 points a side
  const r = n + 3,
    base = new Float32Array(r * r),
    rel = new Float32Array(r * r),
    weights = [0, 0, 0, 0],
    corner = [0, 0, 0, 0];
  const place = (column, row) => {
    // the grid cell and the place in it of fine point (column, row) of this chunk, clamped to the land
    const fa = Math.min(Math.max(ci * cells * FINE + column, 0), last * FINE),
      fb = Math.min(Math.max(cj * cells * FINE + row, 0), last * FINE),
      i = Math.min((fa / FINE) | 0, last - 1),
      j = Math.min((fb / FINE) | 0, last - 1),
      u = fa / FINE - i,
      v = fb / FINE - j,
      k = j * stride + i;
    corner[0] = k;
    corner[1] = k + 1;
    corner[2] = k + stride;
    corner[3] = k + stride + 1;
    weights[0] = (1 - u) * (1 - v);
    weights[1] = u * (1 - v);
    weights[2] = (1 - u) * v;
    weights[3] = u * v;
    // as the coarser levels' triangles have it: split along the diagonal from (1, 0) to (0, 1)
    return u + v <= 1
      ? heights[k] + u * (heights[k + 1] - heights[k]) + v * (heights[k + stride] - heights[k])
      : heights[k + stride + 1] +
          (1 - u) * (heights[k + stride] - heights[k + stride + 1]) +
          (1 - v) * (heights[k + 1] - heights[k + stride + 1]);
  };
  for (let row = 0; row < r; row++)
    for (let column = 0; column < r; column++) {
      const h = place(column - 1, row - 1),
        x = x0 + (ci * cells * FINE + column - 1) * step,
        z = z0 + (cj * cells * FINE + row - 1) * step;
      base[row * r + column] = h;
      rel[row * r + column] = relief(x, z, h);
    }
  const positions = new Float32Array(m * m * 3),
    normals = new Float32Array(m * m * 3),
    chunkColors = new Float32Array(m * m * 3),
    uv = new Float32Array(m * m * 2);
  let p = 0;
  for (let row = 0; row < m; row++) {
    const jj = clamp(row - 1, 0, n),
      sb = row === 0 || row === m - 1;
    for (let column = 0; column < m; column++, p++) {
      const ii = clamp(column - 1, 0, n),
        skirt = sb || column === 0 || column === m - 1,
        q = (jj + 1) * r + ii + 1,
        x = x0 + (ci * cells * FINE + ii) * step,
        z = z0 + (cj * cells * FINE + jj) * step;
      place(ii, jj);
      positions[p * 3] = x;
      positions[p * 3 + 1] = base[q] + rel[q] - (skirt ? 5 : 0);
      positions[p * 3 + 2] = z;
      // the grid's normal between its points, as the slope of a height field, plus the relief's slope
      let nx = 0,
        ny = 0,
        nz = 0,
        cr = 0,
        cg = 0,
        cb = 0;
      for (let c = 0; c < 4; c++) {
        normalOf(land, corner[c], _normal);
        nx += _normal[0] * weights[c];
        ny += _normal[1] * weights[c];
        nz += _normal[2] * weights[c];
        cr += SRGB2LIN[colors[corner[c] * 3]] * weights[c];
        cg += SRGB2LIN[colors[corner[c] * 3 + 1]] * weights[c];
        cb += SRGB2LIN[colors[corner[c] * 3 + 2]] * weights[c];
      }
      const gx = -nx / ny + (rel[q + 1] - rel[q - 1]) / (2 * step),
        gz = -nz / ny + (rel[q + r] - rel[q - r]) / (2 * step),
        len = Math.hypot(gx, 1, gz);
      normals[p * 3] = -gx / len;
      normals[p * 3 + 1] = 1 / len;
      normals[p * 3 + 2] = -gz / len;
      chunkColors[p * 3] = cr;
      chunkColors[p * 3 + 1] = cg;
      chunkColors[p * 3 + 2] = cb;
      uv[p * 2] = x / 9;
      uv[p * 2 + 1] = z / 9;
    }
  }
  return chunkGeometry(positions, normals, chunkColors, uv, m, bedY);
}
// Builds the ground at its coarsest or, with initialPosition {x, y, z}, at the levels seen from that position.
// The returned updater follows camera.position as the viewer moves. `materials` is the pair
// every chunk is drawn with (ground, deep bed), or a function giving the pair (or the one material) for the chunk that covers
// (x0, z0) to (x1, z1). `held`: [{ box: [x0, z0, x1, z1], range, level }], ground over which something finer is laid on the mesh
// at a level of detail or finer, a list that may fill later: within `range` metres of its box
// the chunks under it are kept at `level` (0 the finest) or finer, and the updater sets its `fine` once they all stand so. A land
// with fine relief (`relief`, `groundAt`) has a level finer still near the eye (buildFineGeometry). All chunks of one material
// are one batch of geometry pieces: those in view are drawn together, and a
// chunk's vertices are on the card only, at the one level it is shown at.
export function terrainChunks(parent, land, materials, {
  camera, createBatch, lodScale = () => 1, distances = [330, 680, 1250], held = [], initialPosition,
  fineRange = 70, fineHeight = 90, altitudeStart = 120, altitudeWeight = 0.6, checksPerFrame = 8,
}) {
  const width = land.cells * land.spacing,
    count = (land.stride - 1) / land.cells;
  const batches = new Map(); // material -> the batch of every chunk drawn in it
  const batchOf = material => {
    if (!batches.has(material)) {
      const batch = createBatch(material);
      parent.add(batch);
      batches.set(material, batch);
    }
    return batches.get(material);
  };
  // Puts a chunk on the card at a level of detail, in place of the level it was at
  const show = (chunk, lod) => {
    for (const [batch, id] of chunk.pieces) batch.remove(id);
    const geometry = lod < 0 ? buildFineGeometry(land, chunk.ci, chunk.cj) : buildChunkGeometry(land, chunk.ci, chunk.cj, lod),
      whole = [{ start: 0, count: geometry.index.count, materialIndex: 0 }],
      paired = Array.isArray(chunk.materials) && geometry.groups.length > 0, // ground and deep bed, each in its own material
      own = [].concat(chunk.materials);
    chunk.pieces = (paired ? geometry.groups : whole).map(part => {
      const batch = batchOf(own[part.materialIndex]);
      return [batch, batch.add(geometry, part.start, part.count)];
    });
    chunk.lod = lod;
  };
  const chunks = [];
  for (let cj = 0; cj < count; cj++)
    for (let ci = 0; ci < count; ci++) {
      const x0 = land.x0 + ci * width,
        z0 = land.z0 + cj * width,
        chunk = {
          ci,
          cj,
          cx: land.x0 + (ci + 0.5) * width,
          cz: land.z0 + (cj + 0.5) * width,
          materials: typeof materials === 'function' ? materials(x0, z0, x0 + width, z0 + width) : materials,
          pieces: [],
          lod: null,
          holds: null, // the ground held over this chunk (`held`), once seen
        };
      if (!initialPosition) show(chunk, 3);
      chunks.push(chunk);
    }
  const boxOf = chunk => [chunk.cx - width / 2, chunk.cz - width / 2, chunk.cx + width / 2, chunk.cz + width / 2],
    overlaps = (firstBounds, secondBounds) => firstBounds[0] < secondBounds[2] && secondBounds[0] < firstBounds[2] && firstBounds[1] < secondBounds[3] && secondBounds[1] < firstBounds[3],
    nearBox = (box, range, position) =>
      Math.hypot(
        Math.max(box[0] - position.x, 0, position.x - box[2]),
        Math.max(box[1] - position.z, 0, position.z - box[3]),
      ) <
      range * lodScale();
  // the chunks under ground held at a level, found when it is first seen (the list may fill later)
  const holdUnder = h => {
    h.chunks = chunks.filter(chunk => overlaps(boxOf(chunk), h.box));
    h.fine = false;
    for (const chunk of h.chunks) (chunk.holds ??= []).push(h);
  };
  // the level a chunk wants, `want` by its distance, or finer where ground over it is held within range
  const heldLevel = (chunk, want, position) => {
    if (chunk.holds)
      for (let i = 0; i < chunk.holds.length; i++) if (nearBox(chunk.holds[i].box, chunk.holds[i].range, position)) want = Math.min(want, chunk.holds[i].level);
    return want;
  };
  // whether every chunk under held ground stands at its level or finer
  const standsAt = h => {
    for (let i = 0; i < h.chunks.length; i++) if (h.chunks[i].lod > h.level) return false;
    return true;
  };
  let chunkCursor = 0;
  const update = (force, position) => {
    for (let i = 0; i < held.length; i++) if (!held[i].chunks) holdUnder(held[i]);
    // Re-evaluate a few chunks per frame; put at most one at another level per frame. The fine level is drawn only near the eye.
    const low = !!land.relief && position.y < land.groundAt(position.x, position.z) + fineHeight;
    let built = false;
    const count = force ? chunks.length : checksPerFrame;
    for (let n = 0; n < count; n++) {
      const chunk = chunks[chunkCursor];
      chunkCursor = (chunkCursor + 1) % chunks.length;
      const dx = Math.max(Math.abs(position.x - chunk.cx) - width * 0.5, 0),
        dz = Math.max(Math.abs(position.z - chunk.cz) - width * 0.5, 0);
      const viewDistance = Math.hypot(dx, dz, Math.max(0, position.y - altitudeStart) * altitudeWeight);
      const fine = low && Math.hypot(dx, dz) < fineRange;
      const want = fine
        ? -1
        : heldLevel(
            chunk,
            viewDistance < distances[0] * lodScale() ? 0 : viewDistance < distances[1] * lodScale() ? 1 : viewDistance < distances[2] * lodScale() ? 2 : 3,
            position,
          );
      if (want === chunk.lod || (built && !force)) continue;
      show(chunk, want);
      built = true;
    }
    for (let i = 0; i < held.length; i++) held[i].fine = nearBox(held[i].box, held[i].range, position) && standsAt(held[i]);
  };
  if (initialPosition) update(true, initialPosition);
  return force => update(force, camera.position);
}


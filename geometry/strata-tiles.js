// Geomorphable square tiles, using the same active cells at all three levels. Boxes
// carry raw attributes for a renderer and can be built on another thread or yielded between tiles.
export function createStrataTiles({ size, levels, cliffMask, cliffPoint, groundColor, tileSize = 32, boxSizes = [32, 128, 512] }) {
  const half = size / 2, tilesSide = Math.ceil(size / tileSize);
  const tiles = []; // the tiles with rock in them

  // The coarse grid of the cliff mask, 2 m: a 2 m cell is rock if the mask is above zero at any corner. Every level meshes exactly these cells.
  const MASK_SIDE = size / levels[2] + 1;
  let region = null;
  function planRegion() {
    if (region) return; // planned already
    const mn = new Float32Array(MASK_SIDE * MASK_SIDE);
    region = new Uint8Array(MASK_SIDE * MASK_SIDE);
    for (let row = 0; row < MASK_SIDE; row++)
      for (let column = 0; column < MASK_SIDE; column++) mn[row * MASK_SIDE + column] = cliffMask(column * levels[2] - half, row * levels[2] - half);
    for (let row = 0; row < MASK_SIDE - 1; row++)
      for (let column = 0; column < MASK_SIDE - 1; column++) {
        const k = row * MASK_SIDE + column;
        if (Math.max(mn[k], mn[k + 1], mn[k + MASK_SIDE], mn[k + MASK_SIDE + 1]) > 0.004) region[k] = 1;
      }
    for (let tj = 0; tj < tilesSide; tj++)
      for (let ti = 0; ti < tilesSide; ti++) {
        const n = tileSize / levels[2];
        let any = false;
        for (let row = tj * n; row < (tj + 1) * n && row < MASK_SIDE - 1 && !any; row++)
          for (let column = ti * n; column < (ti + 1) * n && column < MASK_SIDE - 1; column++)
            if (region[row * MASK_SIDE + column]) {
              any = true;
              break;
            }
        if (any) tiles.push({ id: tj * tilesSide + ti, ti, tj, x0: ti * tileSize - half, z0: tj * tileSize - half, y0: 1e9, y1: -1e9, want: 2 });
      }
  }
  const inRegion = (x, z) => {
    const column = Math.floor((x + half) / levels[2]),
      row = Math.floor((z + half) / levels[2]);
    return column >= 0 && row >= 0 && column < MASK_SIDE - 1 && row < MASK_SIDE - 1 && region[row * MASK_SIDE + column] === 1;
  };

  // One level's node grid over a tile, with a ring of one node round it for the normals: positions for every node that a rock cell touches
  // (and their ring), normals for the cell corners.
  const pt = { p: [0, 0, 0] };
  function tileGrid(t, levelIndex, keepAttrs) {
    const g = levels[levelIndex],
      n = tileSize / g,
      w = n + 3,
      used = new Uint8Array(w * w),
      corner = new Uint8Array(w * w);
    for (let row = 0; row < n; row++)
      for (let column = 0; column < n; column++) {
        if (!inRegion(t.x0 + (column + 0.5) * g, t.z0 + (row + 0.5) * g)) continue;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) used[(row + j) * w + column + i] = 1;
        for (let j = 1; j < 3; j++) for (let i = 1; i < 3; i++) corner[(row + j) * w + column + i] = 1;
      }
    const positions = new Float32Array(w * w * 3),
      normals = new Float32Array(w * w * 3),
      attributes = keepAttrs ? new Float32Array(w * w * 6) : null;
    for (let row = 0; row < w; row++)
      for (let column = 0; column < w; column++) {
        const k = row * w + column;
        if (!used[k]) continue;
        cliffPoint(t.x0 + (column - 1) * g, t.z0 + (row - 1) * g, levelIndex, pt);
        positions[k * 3] = pt.p[0];
        positions[k * 3 + 1] = pt.p[1];
        positions[k * 3 + 2] = pt.p[2];
        if (attributes) {
          attributes[k * 6] = pt.bed;
          attributes[k * 6 + 1] = pt.hard;
          attributes[k * 6 + 2] = pt.cav;
          attributes[k * 6 + 3] = pt.m;
          attributes[k * 6 + 4] = pt.yy;
        }
      }
    for (let row = 1; row < w - 1; row++)
      for (let column = 1; column < w - 1; column++) {
        const k = row * w + column;
        if (!corner[k]) continue;
        const ax = positions[(k + 1) * 3] - positions[(k - 1) * 3],
          ay = positions[(k + 1) * 3 + 1] - positions[(k - 1) * 3 + 1],
          az = positions[(k + 1) * 3 + 2] - positions[(k - 1) * 3 + 2];
        const bx = positions[(k + w) * 3] - positions[(k - w) * 3],
          by = positions[(k + w) * 3 + 1] - positions[(k - w) * 3 + 1],
          bz = positions[(k + w) * 3 + 2] - positions[(k - w) * 3 + 2];
        let nx = by * az - bz * ay,
          ny = bz * ax - bx * az,
          nz = bx * ay - by * ax;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        normals[k * 3] = nx;
        normals[k * 3 + 1] = ny;
        normals[k * 3 + 2] = nz;
      }
    return { g, n, w, P: positions, N: normals, A: attributes, corner };
  }
  // A coarser grid's surface at a point of the tile, interpolated over its triangles as that level's mesh draws them.
  function sample(tile, lx, lz, arr, out) {
    const fx = Math.min(lx / tile.g, tile.n - 1e-6),
      fz = Math.min(lz / tile.g, tile.n - 1e-6),
      i = Math.floor(fx),
      j = Math.floor(fz),
      tx = fx - i,
      tz = fz - j;
    const k = (j + 1) * tile.w + i + 1,
      nearLeft = k * 3,
      nearRight = (k + 1) * 3,
      farLeft = (k + tile.w) * 3,
      e = (k + tile.w + 1) * 3;
    for (let q = 0; q < 3; q++)
      out[q] =
        tx + tz <= 1
          ? arr[nearLeft + q] + (arr[nearRight + q] - arr[nearLeft + q]) * tx + (arr[farLeft + q] - arr[nearLeft + q]) * tz
          : arr[e + q] + (arr[farLeft + q] - arr[e + q]) * (1 - tx) + (arr[nearRight + q] - arr[e + q]) * (1 - tz);
    return out;
  }

  // The arrays of one level of a box of tiles, as a generator that yields now and then so the work can be spread over frames; it returns
  // { attributes: { name: [array, itemSize] }, index, bounds: [tile id, lowest y, highest y, ...] }.
  function* boxArrays(levelIndex, list) {
    const positions = [],
      normals = [],
      m1 = [],
      n1 = [],
      m2 = [],
      n2 = [],
      col = [],
      rock = [],
      yy = [],
      par = [],
      indices = [],
      s3 = [0, 0, 0],
      c3 = [0, 0, 0],
      bounds = [];
    for (const t of list) {
      const f = tileGrid(t, levelIndex, true);
      yield;
      const c1 = levelIndex < 2 ? tileGrid(t, levelIndex + 1, false) : null,
        c2 = levelIndex < 1 ? tileGrid(t, 2, false) : null;
      if (c1) yield;
      const map = new Int32Array(f.w * f.w).fill(-1),
        base = positions.length / 3;
      let vi = base,
        y0 = 1e9,
        y1 = -1e9;
      for (let row = 1; row < f.w - 1; row++)
        for (let column = 1; column < f.w - 1; column++) {
          const k = row * f.w + column;
          if (!f.corner[k]) continue;
          map[k] = vi++;
          positions.push(f.P[k * 3], f.P[k * 3 + 1], f.P[k * 3 + 2]);
          normals.push(f.N[k * 3], f.N[k * 3 + 1], f.N[k * 3 + 2]);
          const lx = (column - 1) * f.g,
            lz = (row - 1) * f.g,
            x = t.x0 + lx,
            z = t.z0 + lz;
          if (c1) {
            m1.push(...sample(c1, lx, lz, c1.P, s3));
            const nn = sample(c1, lx, lz, c1.N, s3),
              l = Math.hypot(...nn) || 1;
            n1.push(nn[0] / l, nn[1] / l, nn[2] / l);
          }
          if (c2) {
            m2.push(...sample(c2, lx, lz, c2.P, s3));
            const nn = sample(c2, lx, lz, c2.N, s3),
              l = Math.hypot(...nn) || 1;
            n2.push(nn[0] / l, nn[1] / l, nn[2] / l);
          }
          col.push(...groundColor(x, z, c3));
          rock.push(f.A[k * 6], f.A[k * 6 + 1], f.A[k * 6 + 2], f.A[k * 6 + 3]);
          yy.push(f.A[k * 6 + 4]);
          par.push(x, z, t.id);
          y0 = Math.min(y0, f.P[k * 3 + 1]);
          y1 = Math.max(y1, f.P[k * 3 + 1]);
        }
      bounds.push(t.id, y0, y1);
      for (let row = 1; row < f.w - 2; row++)
        for (let column = 1; column < f.w - 2; column++) {
          if (!inRegion(t.x0 + (column - 0.5) * f.g, t.z0 + (row - 0.5) * f.g)) continue;
          const i00 = map[row * f.w + column],
            i10 = map[row * f.w + column + 1],
            i01 = map[(row + 1) * f.w + column],
            i11 = map[(row + 1) * f.w + column + 1];
          indices.push(i00, i01, i10, i10, i01, i11);
        }
      yield;
    }
    const packAttribute = (values, n) => [new Float32Array(values), n],
      attributes = { position: packAttribute(positions, 3), normal: packAttribute(normals, 3), color: packAttribute(col, 3), aRock: packAttribute(rock, 4), aYY: packAttribute(yy, 1), aParam: packAttribute(par, 3) };
    if (levelIndex < 2) Object.assign(attributes, { aM1: packAttribute(m1, 3), aN1: packAttribute(n1, 3) });
    if (levelIndex < 1) Object.assign(attributes, { aM2: packAttribute(m2, 3), aN2: packAttribute(n2, 3) });
    return { attributes, index: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), bounds };
  }
  const boxKey = (t, levelIndex) => Math.floor((t.x0 + half) / boxSizes[levelIndex]) + ':' + Math.floor((t.z0 + half) / boxSizes[levelIndex]);
  function tilesIn(levelIndex, key) {
    return tiles.filter(t => boxKey(t, levelIndex) === key);
  }

  // The arrays of the box `key` at level `levelIndex`, all at once.
  function boxNow(levelIndex, key) {
    const it = boxArrays(levelIndex, tilesIn(levelIndex, key));
    for (;;) {
      const step = it.next();
      if (step.done) return step.value;
    }
  }

  // The tiles with rock and the 2 m cells that are rock, as plain data (a copy of the cells), and the page taking them from a worker.
  const regionPlan = () => ({ region: region.slice(), tiles });
  function takeRegion(plan) {
    region = plan.region;
    if (plan.tiles !== tiles) { tiles.length = 0; tiles.push(...plan.tiles); }
  }
  return { boxArrays, boxKey, boxNow, planRegion, regionPlan, takeRegion, tileSize, tiles, tilesSide, tilesIn };
}

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
    for (let b = 0; b < MASK_SIDE; b++)
      for (let a = 0; a < MASK_SIDE; a++) mn[b * MASK_SIDE + a] = cliffMask(a * levels[2] - half, b * levels[2] - half);
    for (let b = 0; b < MASK_SIDE - 1; b++)
      for (let a = 0; a < MASK_SIDE - 1; a++) {
        const k = b * MASK_SIDE + a;
        if (Math.max(mn[k], mn[k + 1], mn[k + MASK_SIDE], mn[k + MASK_SIDE + 1]) > 0.004) region[k] = 1;
      }
    for (let tj = 0; tj < tilesSide; tj++)
      for (let ti = 0; ti < tilesSide; ti++) {
        const n = tileSize / levels[2];
        let any = false;
        for (let b = tj * n; b < (tj + 1) * n && b < MASK_SIDE - 1 && !any; b++)
          for (let a = ti * n; a < (ti + 1) * n && a < MASK_SIDE - 1; a++)
            if (region[b * MASK_SIDE + a]) {
              any = true;
              break;
            }
        if (any) tiles.push({ id: tj * tilesSide + ti, ti, tj, x0: ti * tileSize - half, z0: tj * tileSize - half, y0: 1e9, y1: -1e9, want: 2 });
      }
  }
  const inRegion = (x, z) => {
    const a = Math.floor((x + half) / levels[2]),
      b = Math.floor((z + half) / levels[2]);
    return a >= 0 && b >= 0 && a < MASK_SIDE - 1 && b < MASK_SIDE - 1 && region[b * MASK_SIDE + a] === 1;
  };

  // One level's node grid over a tile, with a ring of one node round it for the normals: positions for every node that a rock cell touches
  // (and their ring), normals for the cell corners.
  const pt = { p: [0, 0, 0] };
  function tileGrid(t, lv, keepAttrs) {
    const g = levels[lv],
      n = tileSize / g,
      w = n + 3,
      used = new Uint8Array(w * w),
      corner = new Uint8Array(w * w);
    for (let b = 0; b < n; b++)
      for (let a = 0; a < n; a++) {
        if (!inRegion(t.x0 + (a + 0.5) * g, t.z0 + (b + 0.5) * g)) continue;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) used[(b + j) * w + a + i] = 1;
        for (let j = 1; j < 3; j++) for (let i = 1; i < 3; i++) corner[(b + j) * w + a + i] = 1;
      }
    const P = new Float32Array(w * w * 3),
      N = new Float32Array(w * w * 3),
      A = keepAttrs ? new Float32Array(w * w * 6) : null;
    for (let b = 0; b < w; b++)
      for (let a = 0; a < w; a++) {
        const k = b * w + a;
        if (!used[k]) continue;
        cliffPoint(t.x0 + (a - 1) * g, t.z0 + (b - 1) * g, lv, pt);
        P[k * 3] = pt.p[0];
        P[k * 3 + 1] = pt.p[1];
        P[k * 3 + 2] = pt.p[2];
        if (A) {
          A[k * 6] = pt.bed;
          A[k * 6 + 1] = pt.hard;
          A[k * 6 + 2] = pt.cav;
          A[k * 6 + 3] = pt.m;
          A[k * 6 + 4] = pt.yy;
        }
      }
    for (let b = 1; b < w - 1; b++)
      for (let a = 1; a < w - 1; a++) {
        const k = b * w + a;
        if (!corner[k]) continue;
        const ax = P[(k + 1) * 3] - P[(k - 1) * 3],
          ay = P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1],
          az = P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2];
        const bx = P[(k + w) * 3] - P[(k - w) * 3],
          by = P[(k + w) * 3 + 1] - P[(k - w) * 3 + 1],
          bz = P[(k + w) * 3 + 2] - P[(k - w) * 3 + 2];
        let nx = by * az - bz * ay,
          ny = bz * ax - bx * az,
          nz = bx * ay - by * ax;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        N[k * 3] = nx;
        N[k * 3 + 1] = ny;
        N[k * 3 + 2] = nz;
      }
    return { g, n, w, P, N, A, corner };
  }
  // A coarser grid's surface at a point of the tile, interpolated over its triangles as that level's mesh draws them.
  function sample(c, lx, lz, arr, out) {
    const fx = Math.min(lx / c.g, c.n - 1e-6),
      fz = Math.min(lz / c.g, c.n - 1e-6),
      i = Math.floor(fx),
      j = Math.floor(fz),
      tx = fx - i,
      tz = fz - j;
    const k = (j + 1) * c.w + i + 1,
      a = k * 3,
      b = (k + 1) * 3,
      d = (k + c.w) * 3,
      e = (k + c.w + 1) * 3;
    for (let q = 0; q < 3; q++)
      out[q] =
        tx + tz <= 1
          ? arr[a + q] + (arr[b + q] - arr[a + q]) * tx + (arr[d + q] - arr[a + q]) * tz
          : arr[e + q] + (arr[d + q] - arr[e + q]) * (1 - tx) + (arr[b + q] - arr[e + q]) * (1 - tz);
    return out;
  }

  // The arrays of one level of a box of tiles, as a generator that yields now and then so the work can be spread over frames; it returns
  // { attributes: { name: [array, itemSize] }, index, bounds: [tile id, lowest y, highest y, ...] }.
  function* boxArrays(lv, list) {
    const pos = [],
      nor = [],
      m1 = [],
      n1 = [],
      m2 = [],
      n2 = [],
      col = [],
      rock = [],
      yy = [],
      par = [],
      idx = [],
      s3 = [0, 0, 0],
      c3 = [0, 0, 0],
      bounds = [];
    for (const t of list) {
      const f = tileGrid(t, lv, true);
      yield;
      const c1 = lv < 2 ? tileGrid(t, lv + 1, false) : null,
        c2 = lv < 1 ? tileGrid(t, 2, false) : null;
      if (c1) yield;
      const map = new Int32Array(f.w * f.w).fill(-1),
        base = pos.length / 3;
      let vi = base,
        y0 = 1e9,
        y1 = -1e9;
      for (let b = 1; b < f.w - 1; b++)
        for (let a = 1; a < f.w - 1; a++) {
          const k = b * f.w + a;
          if (!f.corner[k]) continue;
          map[k] = vi++;
          pos.push(f.P[k * 3], f.P[k * 3 + 1], f.P[k * 3 + 2]);
          nor.push(f.N[k * 3], f.N[k * 3 + 1], f.N[k * 3 + 2]);
          const lx = (a - 1) * f.g,
            lz = (b - 1) * f.g,
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
      for (let b = 1; b < f.w - 2; b++)
        for (let a = 1; a < f.w - 2; a++) {
          if (!inRegion(t.x0 + (a - 0.5) * f.g, t.z0 + (b - 0.5) * f.g)) continue;
          const i00 = map[b * f.w + a],
            i10 = map[b * f.w + a + 1],
            i01 = map[(b + 1) * f.w + a],
            i11 = map[(b + 1) * f.w + a + 1];
          idx.push(i00, i01, i10, i10, i01, i11);
        }
      yield;
    }
    const F = (a, n) => [new Float32Array(a), n],
      attributes = { position: F(pos, 3), normal: F(nor, 3), color: F(col, 3), aRock: F(rock, 4), aYY: F(yy, 1), aParam: F(par, 3) };
    if (lv < 2) Object.assign(attributes, { aM1: F(m1, 3), aN1: F(n1, 3) });
    if (lv < 1) Object.assign(attributes, { aM2: F(m2, 3), aN2: F(n2, 3) });
    return { attributes, index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), bounds };
  }
  const boxKey = (t, lv) => Math.floor((t.x0 + half) / boxSizes[lv]) + ':' + Math.floor((t.z0 + half) / boxSizes[lv]);
  function tilesIn(lv, key) {
    return tiles.filter(t => boxKey(t, lv) === key);
  }

  // The arrays of the box `key` at level `lv`, all at once.
  function boxNow(lv, key) {
    const it = boxArrays(lv, tilesIn(lv, key));
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

import { clamp, lerp, sstep } from '../math/scalar.js';
import { createNoise } from '../math/noise.js';
import { createHash, mulberry32 } from '../math/random.js';
import { SRGB2LIN } from '../math/color.js';

// Heightfields are square and centred on the origin. All lengths and elevations are metres.
// Exposure is the caller's rise/run attenuated to zero wherever rock must be excluded.
export function createStrataField({ seed = 0, cells, spacing, levels = [0.5, 1, 2], slopeRange = [0.8, 1.08], bedRange = [-80, 460] }) {
  const stride = cells + 1, half = cells * spacing / 2;
  const { fbm, vnoise } = createNoise(seed), hash2 = createHash(seed);
  let heights, colours;
  function setGround(input) {
    heights = input.heights;
    colours = input.colours;
  }
  let mask = null, // 0..1, how much of a cliff stands here
    nrm = null, // the terrain normal smoothed over about 12 m, the direction the rock is pushed out
    band = null; // 0..1, the character of the band of cliffs a cell belongs to (relief, colour)
  function makeGrids() {
    mask ??= new Float32Array(stride * stride);
    nrm ??= new Float32Array(stride * stride * 3);
    band ??= new Float32Array(stride * stride);
  }

  // The beds, bottom to top: packages of massive hard beds, of thin soft ones, and of middling ones.
  const BED = { y0: bedRange[0], step: 0.1, top: [], thick: [], hard: [], tint: [], index: null };
  (() => {
    const R = mulberry32(seed * 7 + 311);
    let y = BED.y0;
    while (y < bedRange[1]) {
      const kind = R(),
        n = kind < 0.36 ? 1 + ((R() * 2) | 0) : kind < 0.66 ? 3 + ((R() * 4) | 0) : 2 + ((R() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const t = kind < 0.36 ? lerp(3.5, 8, R()) : kind < 0.66 ? lerp(0.9, 2.2, R()) : lerp(2.2, 4.5, R());
        const hard = kind < 0.36 ? lerp(0.78, 1, R()) : kind < 0.66 ? lerp(0.12, 0.5, R()) : lerp(0.5, 0.88, R());
        BED.top.push(y + t);
        BED.thick.push(t);
        BED.hard.push(hard);
        BED.tint.push(R());
        y += t;
      }
    }
    BED.index = new Int16Array(Math.ceil((y - BED.y0) / BED.step));
    for (let i = 0, b = 0; i < BED.index.length; i++) {
      const yy = BED.y0 + (i + 0.5) * BED.step;
      while (BED.top[b] < yy) b++;
      BED.index[i] = b;
    }
  })();
  function bedAt(yy) {
    return BED.index[clamp(((yy - BED.y0) / BED.step) | 0, 0, BED.index.length - 1)];
  }

  function planCliffShape(input) {
    setGround(input);
    const normals = input.normals;
    makeGrids();
    band.fill(0);
    // Blur the supplied exposure so each band falls away through a soft edge.
    const raw = new Float32Array(stride * stride),
      tmp = new Float32Array(stride * stride);
    for (let j = 0; j <= cells; j++)
      for (let i = 0; i <= cells; i++) {
        const k = j * stride + i,
          x = i * spacing - half,
          z = j * spacing - half,
          exposure = input.exposure(k, x, z);
        raw[k] = exposure;
      }
    blur(raw, tmp, 1);
    blur(raw, tmp, 1);
    for (let k = 0; k < mask.length; k++) mask[k] = sstep(slopeRange[0], slopeRange[1], raw[k]);
    // bands: neighbouring cliff cells grouped; a speck of a few cells is dropped, and each band gets a character of its own
    const id = new Int32Array(stride * stride).fill(-1),
      stack = [];
    let bands = 0;
    for (let k0 = 0; k0 < mask.length; k0++) {
      if (mask[k0] < 0.5 || id[k0] >= 0) continue;
      const connected = [];
      id[k0] = bands;
      stack.push(k0);
      while (stack.length) {
        const k = stack.pop(),
          i = k % stride,
          j = (k / stride) | 0;
        connected.push(k);
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const a = i + di,
              b = j + dj,
              kk = b * stride + a;
            if (a < 0 || b < 0 || a > cells || b > cells || id[kk] >= 0 || mask[kk] < 0.5) continue;
            id[kk] = bands;
            stack.push(kk);
          }
      }
      const ch = hash2(bands, 0, 532);
      for (const k of connected) band[k] = connected.length < 7 ? -1 : ch;
      bands++;
    }
    for (let k = 0; k < mask.length; k++)
      if (band[k] < 0) {
        band[k] = 0;
        mask[k] *= 0.3;
      } // a speck: a little rock, no cliff
    for (let pass = 0; pass < 3; pass++) {
      // each band's character reaches out over its soft edge
      tmp.set(band);
      for (let j = 1; j < cells; j++)
        for (let i = 1; i < cells; i++) {
          const k = j * stride + i;
          if (mask[k] >= 0.5 || mask[k] === 0) continue;
          let s = 0,
            n = 0;
          for (const kk of [k - 1, k + 1, k - stride, k + stride])
            if (tmp[kk] > 0) {
              s += tmp[kk];
              n++;
            }
          if (n) band[k] = s / n;
        }
    }
    // the smoothed normal
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < raw.length; k++) raw[k] = normals[k * 3 + c];
      blur(raw, tmp, 1);
      blur(raw, tmp, 1);
      blur(raw, tmp, 1);
      for (let k = 0; k < raw.length; k++) nrm[k * 3 + c] = raw[k];
    }
    for (let k = 0; k < raw.length; k++) {
      const l = Math.hypot(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]) || 1;
      nrm[k * 3] /= l;
      nrm[k * 3 + 1] /= l;
      nrm[k * 3 + 2] /= l;
    }
  }
  function blur(a, t, r) {
    // separable box blur of radius r cells, in place
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? t : a,
        dst = pass ? a : t,
        sx = pass ? stride : 1,
        sy = pass ? 1 : stride;
      for (let j = 0; j <= cells; j++)
        for (let i = 0; i <= cells; i++) {
          let s = 0,
            n = 0;
          for (let d = -r; d <= r; d++) {
            const ii = i + d;
            if (ii < 0 || ii > cells) continue;
            s += src[j * sy + ii * sx];
            n++;
          }
          dst[j * sy + i * sx] = s / n;
        }
    }
  }

  // Bilinear reads of the grids, and the terrain's own height as its finest mesh draws it (two triangles a cell, split the same way).
  const cell = { i: 0, j: 0, tx: 0, tz: 0 };
  function locate(x, z) {
    let fx = (x + half) / spacing,
      fz = (z + half) / spacing;
    fx = clamp(fx, 0, cells - 1e-4);
    fz = clamp(fz, 0, cells - 1e-4);
    cell.i = fx | 0;
    cell.j = fz | 0;
    cell.tx = fx - cell.i;
    cell.tz = fz - cell.j;
    return cell.j * stride + cell.i;
  }
  function bilerp(g, k, n, c) {
    const { tx, tz } = cell,
      a = g[k * n + c],
      b = g[(k + 1) * n + c],
      d = g[(k + stride) * n + c],
      e = g[(k + stride + 1) * n + c];
    return a + (b - a) * tx + (d - a) * tz + (a - b - d + e) * tx * tz;
  }
  function meshHeight(x, z) {
    const k = locate(x, z),
      { tx, tz } = cell,
      a = heights[k],
      b = heights[k + 1],
      c = heights[k + stride],
      d = heights[k + stride + 1];
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  function cliffMask(x, z) {
    return mask ? bilerp(mask, locate(x, z), 1, 0) : 0;
  }

  // Joints: the nearest fracture-bounded block in a jittered grid of `size` metres. Writes the block's plane offset at (x, z), and the distance
  // to its nearest edge, to `jnt`.
  const jnt = { off: 0, edge: 0, id: 0 };
  function joints(x, z, size, seed, depth) {
    const gx = x / size,
      gz = z / size,
      ix = Math.floor(gx),
      iz = Math.floor(gz);
    let d1 = 1e9,
      d2 = 1e9,
      ax = 0,
      az = 0,
      bx = 0,
      bz = 0,
      id = 0;
    for (let b = -1; b <= 1; b++)
      for (let a = -1; a <= 1; a++) {
        const cx = ix + a,
          cz = iz + b,
          sx = cx + 0.1 + 0.8 * hash2(cx, cz, seed),
          sz = cz + 0.1 + 0.8 * hash2(cx, cz, seed + 1);
        const d = (sx - gx) ** 2 + (sz - gz) ** 2;
        if (d < d1) {
          d2 = d1;
          bx = ax;
          bz = az;
          d1 = d;
          ax = sx;
          az = sz;
          id = cx * 7919 + cz;
        } else if (d < d2) {
          d2 = d;
          bx = sx;
          bz = sz;
        }
      }
    const ex = bx - ax,
      ez = bz - az,
      el = Math.hypot(ex, ez) || 1;
    jnt.edge = (((bx + ax) * 0.5 - gx) * ex) / el + (((bz + az) * 0.5 - gz) * ez) / el; // to the bisector between the two nearest seeds
    jnt.edge *= size;
    const h1 = hash2(id, 3, seed + 2),
      h2 = hash2(id, 4, seed + 2) - 0.5,
      h3 = hash2(id, 5, seed + 2) - 0.5;
    jnt.off = depth * (0.35 + 0.65 * h1) + (h2 * (gx - ax) + h3 * (gz - az)) * size * 0.16 * depth;
    jnt.off = Math.max(jnt.off, 0);
    jnt.id = id;
    return jnt;
  }

  // The rock surface at the ground point (x, z) for level of detail `lv`. Writes the position and what the shading needs to `o`:
  // o.p (x, y, z), o.yy (the bedding height), o.bed (its tint 0..1), o.hard, o.cav (how far back in a crevice), o.m (cliff mask).
  function cliffPoint(x, z, lv, o) {
    const k = locate(x, z),
      m = bilerp(mask, k, 1, 0),
      bd = bilerp(band, k, 1, 0);
    let nx = bilerp(nrm, k, 3, 0),
      ny = bilerp(nrm, k, 3, 1),
      nz = bilerp(nrm, k, 3, 2);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const h = meshHeight(x, z),
      g = levels[lv];
    const yy = h + 0.045 * x - 0.022 * z + 18 * (fbm(x / 240, z / 240, 3, 533) - 0.5); // beds dip gently to the east and are folded a little
    const b = bedAt(yy),
      hard = clamp(BED.hard[b] + (bd - 0.5) * 0.3, 0, 1),
      T = BED.thick[b],
      u = 1 - (BED.top[b] - yy) / T;
    // strata: a face then a ledge in each bed, at the angles a bed of this hardness keeps on a slope of angle th
    const th = Math.acos(clamp(ny, 0.05, 1)),
      sinT = Math.max(Math.sin(th), 0.3);
    const face = lerp(th + 0.3, 1.62, hard * hard),
      ledge = lerp(th - 0.15, 0.28, hard);
    const tf = Math.tan(clamp(face - th, 0.05, 1.45)),
      tl = Math.tan(clamp(th - ledge, 0.05, 1.3)),
      f = tl / (tf + tl);
    let A = f * (T / sinT) * tf;
    const cap = lerp(0.3, 2.6, sstep(0.25, 0.8, hard)) * (0.75 + 0.5 * bd);
    if (A > cap) A = cap;
    // Use the actual triangle's rise here. A smoothed normal can miss a near-vertical
    // patch: sampling alternating beds there gives one tooth per grid vertex.
    const upper = cell.tx + cell.tz > 1;
    const dhx = upper ? heights[k + stride + 1] - heights[k + stride] : heights[k + 1] - heights[k];
    const dhz = upper ? heights[k + stride + 1] - heights[k + 1] : heights[k + stride] - heights[k];
    const rise = Math.max((Math.abs(dhx) + Math.abs(dhz)) / spacing, 0.5);
    const sampleRise = g * rise, resolved = sstep(4, 9, T / sampleRise);
    const edgeFade = sstep(0, sampleRise * 1.5, T * Math.min(u, 1 - u));
    const ra = u / f,
      rb = (1 - u) / (1 - f),
      tri = Math.max(0, (ra + rb - Math.sqrt((ra - rb) ** 2 + 0.06)) * 0.5); // the lip of each face worn round
    const ds = A * tri * resolved;
    // joints: large blocks through many beds, smaller ones that change from bed to bed, and the chips broken off their faces
    joints(x, z, 7.5 + 3 * bd, 540, 1.0);
    let dj = jnt.off;
    const e1 = jnt.edge;
    joints(x + b * 1.7, z - b * 2.3, 3.1, 560 + b, 0.5);
    dj += jnt.off * (lv === 0 ? 1 : lv === 1 ? 0.5 : 0) * resolved * edgeFade;
    const e2 = jnt.edge;
    if (lv === 0) {
      joints(x - b * 0.7, z + b * 1.3, 1.25, 580 + b, 0.2);
      dj += jnt.off * resolved * edgeFade;
    }
    const groove = 0.6 * sstep(0.9, 0, e1) * (lv === 2 ? 0 : 1) + 0.3 * sstep(0.45, 0, e2) * (lv === 0 ? 1 : 0) * resolved * edgeFade;
    dj = Math.max(dj - groove, 0);
    // relief: broad buttresses and bays, and creased (not rounded) swells at a few metres
    let dn = 1.0 * fbm(x / 31, z / 31, 3, 520) + 0.5 * vnoise((x + z) / 47, yy / 19, 521);
    if (lv < 2) dn += 0.5 * Math.abs(vnoise((x + z) * 0.13, yy * 0.17, 522) + vnoise((x - z) * 0.13, yy * 0.17, 523) - 1);
    const amp = sstep(0.3, 0.9, m) * (0.8 + 0.4 * bd),
      base = lerp(-1.6, 0.3, sstep(0.12, 0.55, m));
    // Ribs and gullies down the fall line: noise drawn out along the slope, sharp on the crests, for faces turned north or south and
    // for faces turned east or west, mixed by which way this one faces
    const wz = (nz * nz) / (nx * nx + nz * nz + 1e-6),
      ridge = v => 1 - Math.abs(2 * v - 1);
    let rib = lerp(ridge(vnoise(z / 11, x / 52, 541)), ridge(vnoise(x / 11, z / 52, 542)), wz) ** 1.6 * 2.4;
    if (lv < 2) rib += lerp(ridge(vnoise(z / 4.2, x / 19, 543)), ridge(vnoise(x / 4.2, z / 19, 544)), wz) * 0.55;
    // where the ground is near vertical the grid has few vertices up the face, so blocks and relief are kept low there (no flakes)
    const sheer = lerp(1, 0.3, sstep(0.95, 1.22, th));
    const off = base + amp * Math.min(ds + rib * lerp(0.5, 1, sstep(0.7, 1.1, th)) + (dj + dn) * sheer, 5);
    o.p[0] = x + nx * off;
    o.p[1] = h + ny * off;
    o.p[2] = z + nz * off;
    o.yy = yy;
    o.bed = lerp(0.5, BED.tint[b], resolved * edgeFade);
    o.hard = lerp(0.6, hard, resolved * edgeFade);
    o.m = m;
    o.h = h;
    o.cav = clamp((1 - (A > 0 ? ds / A : 1)) ** 3 * sstep(0.25, 1.5, A) * 0.8 * resolved * edgeFade + groove * 0.9, 0, 1);
    return o;
  }
  // The baked ground colour at (x, z), in linear light.
  function groundColor(x, z, out) {
    const k = locate(x, z);
    for (let c = 0; c < 3; c++) out[c] = SRGB2LIN[Math.round(bilerp(colours, k, 3, c))];
    return out;
  }

  // The plan as plain arrays (copies: a worker that planned keeps its own), and the page taking a plan a worker made as its own.
  const cliffShapePlan = () => ({ mask: mask.slice(), nrm: nrm.slice(), band: band.slice() });
  function takeCliffShape(plan, input) {
    setGround(input);
    ({ mask, nrm, band } = plan); // the worker's copies, the page's own once they have crossed
  }
  return { levels, cliffMask, cliffPoint, cliffShapePlan, groundColor, planCliffShape, takeCliffShape };
}

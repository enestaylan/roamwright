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
    smoothedNormals = null, // the terrain normal smoothed over about 12 m, the direction the rock is pushed out
    band = null; // 0..1, the character of the band of cliffs a cell belongs to (relief, colour)
  function makeGrids() {
    mask ??= new Float32Array(stride * stride);
    smoothedNormals ??= new Float32Array(stride * stride * 3);
    band ??= new Float32Array(stride * stride);
  }

  // The beds, bottom to top: packages of massive hard beds, of thin soft ones, and of middling ones.
  const bedProfile = { y0: bedRange[0], step: 0.1, top: [], thick: [], hard: [], tint: [], index: null };
  (() => {
    const random = mulberry32(seed * 7 + 311);
    let y = bedProfile.y0;
    while (y < bedRange[1]) {
      const kind = random(),
        n = kind < 0.36 ? 1 + ((random() * 2) | 0) : kind < 0.66 ? 3 + ((random() * 4) | 0) : 2 + ((random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const t = kind < 0.36 ? lerp(3.5, 8, random()) : kind < 0.66 ? lerp(0.9, 2.2, random()) : lerp(2.2, 4.5, random());
        const hard = kind < 0.36 ? lerp(0.78, 1, random()) : kind < 0.66 ? lerp(0.12, 0.5, random()) : lerp(0.5, 0.88, random());
        bedProfile.top.push(y + t);
        bedProfile.thick.push(t);
        bedProfile.hard.push(hard);
        bedProfile.tint.push(random());
        y += t;
      }
    }
    bedProfile.index = new Int16Array(Math.ceil((y - bedProfile.y0) / bedProfile.step));
    for (let i = 0, bedIndex = 0; i < bedProfile.index.length; i++) {
      const yy = bedProfile.y0 + (i + 0.5) * bedProfile.step;
      while (bedProfile.top[bedIndex] < yy) bedIndex++;
      bedProfile.index[i] = bedIndex;
    }
  })();
  function bedAt(yy) {
    return bedProfile.index[clamp(((yy - bedProfile.y0) / bedProfile.step) | 0, 0, bedProfile.index.length - 1)];
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
            const column = i + di,
              row = j + dj,
              kk = row * stride + column;
            if (column < 0 || row < 0 || column > cells || row > cells || id[kk] >= 0 || mask[kk] < 0.5) continue;
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
    for (let channel = 0; channel < 3; channel++) {
      for (let k = 0; k < raw.length; k++) raw[k] = normals[k * 3 + channel];
      blur(raw, tmp, 1);
      blur(raw, tmp, 1);
      blur(raw, tmp, 1);
      for (let k = 0; k < raw.length; k++) smoothedNormals[k * 3 + channel] = raw[k];
    }
    for (let k = 0; k < raw.length; k++) {
      const l = Math.hypot(smoothedNormals[k * 3], smoothedNormals[k * 3 + 1], smoothedNormals[k * 3 + 2]) || 1;
      smoothedNormals[k * 3] /= l;
      smoothedNormals[k * 3 + 1] /= l;
      smoothedNormals[k * 3 + 2] /= l;
    }
  }
  function blur(values, scratch, radius) {
    // separable box blur of the specified radius in cells, in place
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? scratch : values,
        dst = pass ? values : scratch,
        sx = pass ? stride : 1,
        sy = pass ? 1 : stride;
      for (let j = 0; j <= cells; j++)
        for (let i = 0; i <= cells; i++) {
          let s = 0,
            n = 0;
          for (let d = -radius; d <= radius; d++) {
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
  function bilerp(grid, cellIndex, components, channel) {
    const { tx, tz } = cell,
      nearLeft = grid[cellIndex * components + channel],
      nearRight = grid[(cellIndex + 1) * components + channel],
      farLeft = grid[(cellIndex + stride) * components + channel],
      farRight = grid[(cellIndex + stride + 1) * components + channel];
    return nearLeft + (nearRight - nearLeft) * tx + (farLeft - nearLeft) * tz + (nearLeft - nearRight - farLeft + farRight) * tx * tz;
  }
  function meshHeight(x, z) {
    const k = locate(x, z),
      { tx, tz } = cell,
      nearLeft = heights[k],
      nearRight = heights[k + 1],
      farLeft = heights[k + stride],
      farRight = heights[k + stride + 1];
    return tx + tz <= 1 ? nearLeft + (nearRight - nearLeft) * tx + (farLeft - nearLeft) * tz : farRight + (farLeft - farRight) * (1 - tx) + (nearRight - farRight) * (1 - tz);
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
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++)
      for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
        const cx = ix + columnOffset,
          cz = iz + rowOffset,
          sx = cx + 0.1 + 0.8 * hash2(cx, cz, seed),
          sz = cz + 0.1 + 0.8 * hash2(cx, cz, seed + 1);
        const distanceSquared = (sx - gx) ** 2 + (sz - gz) ** 2;
        if (distanceSquared < d1) {
          d2 = d1;
          bx = ax;
          bz = az;
          d1 = distanceSquared;
          ax = sx;
          az = sz;
          id = cx * 7919 + cz;
        } else if (distanceSquared < d2) {
          d2 = distanceSquared;
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

  // The rock surface at the ground point (x, z) for level of detail `levelIndex`. Writes the position and what the shading needs to `output`:
  // output.p (x, y, z), output.yy (the bedding height), output.bed (its tint 0..1), output.hard, output.cav (how far back in a crevice), output.m (cliff mask).
  function cliffPoint(x, z, levelIndex, output) {
    const k = locate(x, z),
      maskValue = bilerp(mask, k, 1, 0),
      bd = bilerp(band, k, 1, 0);
    let nx = bilerp(smoothedNormals, k, 3, 0),
      ny = bilerp(smoothedNormals, k, 3, 1),
      nz = bilerp(smoothedNormals, k, 3, 2);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const h = meshHeight(x, z),
      gridSpacing = levels[levelIndex];
    const yy = h + 0.045 * x - 0.022 * z + 18 * (fbm(x / 240, z / 240, 3, 533) - 0.5); // beds dip gently to the east and are folded a little
    const bed = bedAt(yy),
      hard = clamp(bedProfile.hard[bed] + (bd - 0.5) * 0.3, 0, 1),
      bedThickness = bedProfile.thick[bed],
      u = 1 - (bedProfile.top[bed] - yy) / bedThickness;
    // strata: a face then a ledge in each bed, at the angles a bed of this hardness keeps on a slope of angle th
    const th = Math.acos(clamp(ny, 0.05, 1)),
      sinT = Math.max(Math.sin(th), 0.3);
    const face = lerp(th + 0.3, 1.62, hard * hard),
      ledge = lerp(th - 0.15, 0.28, hard);
    const tf = Math.tan(clamp(face - th, 0.05, 1.45)),
      tl = Math.tan(clamp(th - ledge, 0.05, 1.3)),
      f = tl / (tf + tl);
    let A = f * (bedThickness / sinT) * tf;
    const cap = lerp(0.3, 2.6, sstep(0.25, 0.8, hard)) * (0.75 + 0.5 * bd);
    if (A > cap) A = cap;
    // Use the actual triangle's rise here. A smoothed normal can miss a near-vertical
    // patch: sampling alternating beds there gives one tooth per grid vertex.
    const upper = cell.tx + cell.tz > 1;
    const dhx = upper ? heights[k + stride + 1] - heights[k + stride] : heights[k + 1] - heights[k];
    const dhz = upper ? heights[k + stride + 1] - heights[k + 1] : heights[k + stride] - heights[k];
    const rise = Math.max((Math.abs(dhx) + Math.abs(dhz)) / spacing, 0.5);
    const sampleRise = gridSpacing * rise, resolved = sstep(4, 9, bedThickness / sampleRise);
    const edgeFade = sstep(0, sampleRise * 1.5, bedThickness * Math.min(u, 1 - u));
    const ra = u / f,
      rb = (1 - u) / (1 - f),
      tri = Math.max(0, (ra + rb - Math.sqrt((ra - rb) ** 2 + 0.06)) * 0.5); // the lip of each face worn round
    const ds = A * tri * resolved;
    // joints: large blocks through many beds, smaller ones that change from bed to bed, and the chips broken off their faces
    joints(x, z, 7.5 + 3 * bd, 540, 1.0);
    let dj = jnt.off;
    const e1 = jnt.edge;
    joints(x + bed * 1.7, z - bed * 2.3, 3.1, 560 + bed, 0.5);
    dj += jnt.off * (levelIndex === 0 ? 1 : levelIndex === 1 ? 0.5 : 0) * resolved * edgeFade;
    const e2 = jnt.edge;
    if (levelIndex === 0) {
      joints(x - bed * 0.7, z + bed * 1.3, 1.25, 580 + bed, 0.2);
      dj += jnt.off * resolved * edgeFade;
    }
    const groove = 0.6 * sstep(0.9, 0, e1) * (levelIndex === 2 ? 0 : 1) + 0.3 * sstep(0.45, 0, e2) * (levelIndex === 0 ? 1 : 0) * resolved * edgeFade;
    dj = Math.max(dj - groove, 0);
    // relief: broad buttresses and bays, and creased (not rounded) swells at a few metres
    let dn = 1.0 * fbm(x / 31, z / 31, 3, 520) + 0.5 * vnoise((x + z) / 47, yy / 19, 521);
    if (levelIndex < 2) dn += 0.5 * Math.abs(vnoise((x + z) * 0.13, yy * 0.17, 522) + vnoise((x - z) * 0.13, yy * 0.17, 523) - 1);
    const amp = sstep(0.3, 0.9, maskValue) * (0.8 + 0.4 * bd),
      base = lerp(-1.6, 0.3, sstep(0.12, 0.55, maskValue));
    // Ribs and gullies down the fall line: noise drawn out along the slope, sharp on the crests, for faces turned north or south and
    // for faces turned east or west, mixed by which way this one faces
    const wz = (nz * nz) / (nx * nx + nz * nz + 1e-6),
      ridge = v => 1 - Math.abs(2 * v - 1);
    let rib = lerp(ridge(vnoise(z / 11, x / 52, 541)), ridge(vnoise(x / 11, z / 52, 542)), wz) ** 1.6 * 2.4;
    if (levelIndex < 2) rib += lerp(ridge(vnoise(z / 4.2, x / 19, 543)), ridge(vnoise(x / 4.2, z / 19, 544)), wz) * 0.55;
    // where the ground is near vertical the grid has few vertices up the face, so blocks and relief are kept low there (no flakes)
    const sheer = lerp(1, 0.3, sstep(0.95, 1.22, th));
    const off = base + amp * Math.min(ds + rib * lerp(0.5, 1, sstep(0.7, 1.1, th)) + (dj + dn) * sheer, 5);
    output.p[0] = x + nx * off;
    output.p[1] = h + ny * off;
    output.p[2] = z + nz * off;
    output.yy = yy;
    output.bed = lerp(0.5, bedProfile.tint[bed], resolved * edgeFade);
    output.hard = lerp(0.6, hard, resolved * edgeFade);
    output.m = maskValue;
    output.h = h;
    output.cav = clamp((1 - (A > 0 ? ds / A : 1)) ** 3 * sstep(0.25, 1.5, A) * 0.8 * resolved * edgeFade + groove * 0.9, 0, 1);
    return output;
  }
  // The baked ground colour at (x, z), in linear light.
  function groundColor(x, z, out) {
    const k = locate(x, z);
    for (let channel = 0; channel < 3; channel++) out[channel] = SRGB2LIN[Math.round(bilerp(colours, k, 3, channel))];
    return out;
  }

  // The plan as plain arrays (copies: a worker that planned keeps its own), and the page taking a plan a worker made as its own.
  const cliffShapePlan = () => ({ mask: mask.slice(), nrm: smoothedNormals.slice(), band: band.slice() });
  function takeCliffShape(plan, input) {
    setGround(input);
    ({ mask, nrm: smoothedNormals, band } = plan); // the worker's copies, the page's own once they have crossed
  }
  return { levels, cliffMask, cliffPoint, cliffShapePlan, groundColor, planCliffShape, takeCliffShape };
}

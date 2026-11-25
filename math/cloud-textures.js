import { clamp } from './scalar.js';
import { createNoise } from './noise.js';
import { createHash, mulberry32 } from './random.js';

export function createCloudTextures({
  seed = 0,
  noise = createNoise(seed),
  hash2 = createHash(seed),
  volumeSeed = seed,
} = {}) {
  const { tfbm, tnoise } = noise;
  // A sheet of round domes, one over each of `per` x `per` jittered cells (it tiles): 1 at a dome's middle, 0 where it meets
  // its neighbours in a crease.
  function domes(u, v, per, seed) {
    const gx = u * per,
      gz = v * per,
      ix = Math.floor(gx),
      iz = Math.floor(gz);
    let near = 9;
    for (let b = -1; b <= 1; b++)
      for (let a = -1; a <= 1; a++) {
        const cx = ix + a,
          cz = iz + b,
          wx = ((cx % per) + per) % per,
          wz = ((cz % per) + per) % per,
          d = (cx + 0.15 + 0.7 * hash2(wx, wz, seed) - gx) ** 2 + (cz + 0.15 + 0.7 * hash2(wx, wz, seed + 1) - gz) ** 2;
        if (d < near) near = d;
      }
    return Math.max(0, 1 - near * 2.2);
  }
  // Rounded lumps with creases between them, as a cloud's top is made of: domes at three sizes, from `per` to a sheet.
  function lumps(u, v, per, seed) {
    let s = 0,
      a = 0.5,
      n = 0;
    for (let i = 0; i < 3; i++) {
      s += a * domes(u, v, per, seed + i * 13);
      n += a;
      a *= 0.5;
      per *= 2;
    }
    return s / n;
  }
  // Streaks four times as long as they are wide, at three scales.
  function wisps(u, v) {
    let s = 0,
      a = 0.5,
      n = 0;
    for (let i = 0, per = 3; i < 3; i++, per *= 2, a *= 0.5) {
      s += a * tnoise(u * per, v * per * 4, per, 1259 + i * 13, per * 4);
      n += a;
    }
    return s / n;
  }
  // How much cloud stands at (u, v) of the sheet, 0 to 1, spread as the sky's threshold expects: half the sheet over 0.49, a
  // tenth over 0.63. Everything is bent by one slow noise (bendU, bendV), so no two masses run alike.
  function cloudAmount(u, v, bendU, bendV) {
    const bu = u + bendU * 0.08,
      bv = v + bendV * 0.08;
    return clamp(0.485 + (tfbm(bu, bv, 5, 3, 1223) - 0.5) * 0.63 + (lumps(bu, bv, 11, 1237) - 0.68) * 0.42, 0, 1);
  }
  const cloudBend = (u, v, seed) => tfbm(u, v, 4, 3, seed) - 0.5;
  const cloudField = () => (u, v, o) => {
    const bendU = cloudBend(u, v, 1201),
      bendV = cloudBend(u, v, 1213),
      field = 255 * cloudAmount(u, v, bendU, bendV),
      whole = Math.round(field);
    o[0] = whole;
    o[3] = (field - whole + 0.5) * 255;
    o[1] = 255 * lumps(u + bendV * 0.02, v - bendU * 0.02, 40, 1249);
    o[2] = 255 * clamp(wisps(u + bendU * 0.03, v + bendV * 0.03) * 1.5 - 0.25, 0, 1);
  };
  // The clouds' billows (the cloud dome): a block of round lumps with creases between them, in three dimensions, which
  // repeats every way. A cloud's smooth body, cut from the field, is eaten back in the creases and left standing in the lumps,
  // so its sides and top swell like a cauliflower's. R, G, B: lumps a quarter, an eighth and a sixteenth of the block across;
  // A: broad ones, half the block.
  const CLOUD_VOLUME_LUMPS = [4, 8, 16, 2];
  // Round lumps, one in each of `per` x `per` x `per` jittered cells: 1 at a lump's middle, 0 where it meets its neighbours.
  function lumpBlock(per, seed) {
    const R = mulberry32(seed),
      middles = new Float32Array(per * per * per * 3).map(() => 0.12 + 0.76 * R()),
      wrap = i => ((i % per) + per) % per;
    return (u, v, w) => {
      const x = u * per,
        y = v * per,
        z = w * per,
        ix = Math.floor(x),
        iy = Math.floor(y),
        iz = Math.floor(z);
      let near = 9;
      for (let c = -1; c <= 1; c++)
        for (let b = -1; b <= 1; b++)
          for (let a = -1; a <= 1; a++) {
            const k = ((wrap(iz + c) * per + wrap(iy + b)) * per + wrap(ix + a)) * 3,
              d = (ix + a + middles[k] - x) ** 2 + (iy + b + middles[k + 1] - y) ** 2 + (iz + c + middles[k + 2] - z) ** 2;
            if (d < near) near = d;
          }
      return Math.max(0, 1 - near * 1.7);
    };
  }
  function cloudVolume() {
    const blocks = CLOUD_VOLUME_LUMPS.map((per, i) => lumpBlock(per, volumeSeed + i * 7));
    return (u, v, o, w) => {
      for (let i = 0; i < 4; i++) o[i] = 255 * blocks[i](u, v, w);
    };
  }
  return {
    field: cloudField,
    volume: cloudVolume,
    coverage: (u, v) => cloudAmount(u, v, cloudBend(u, v, 1201), cloudBend(u, v, 1213)),
  };
}

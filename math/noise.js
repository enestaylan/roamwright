/**
 * Seeded two-dimensional noise for terrain heights and seamless textures.
 * @module
 */

import { createHash } from './random.js';

/**
 * Create a family of noise samplers that share a world seed. Use `fbm` for
 * layered terrain, `ridged` for crests and `tfbm` for seamless textures.
 * For a terrain feature spanning roughly 100 metres, divide world X/Z by 100
 * before sampling the first octave. For a texture, pass unit UVs to `tfbm`;
 * the opposite edges of the unit tile match.
 * @example
 * ```js
 * import { createNoise } from 'roamwright';
 *
 * const { fbm, tfbm } = createNoise(42);
 * const groundAt = (x, z) => 30 * fbm(x / 100, z / 100, 4, 7);
 * const grainAt = (u, v) => tfbm(u, v, 8, 3, 11);
 * ```
 * @param worldSeed - Integer offset shared by the samplers. Each sample also accepts its own seed.
 */
export function createNoise(worldSeed = 0) {
  const hash2 = createHash(worldSeed);
  /**
   * Smooth value noise in [0, 1] between integer grid points.
   * @param {number} x - Noise-grid X.
   * @param {number} z - Noise-grid Z.
   * @param {number} seed - Integer sample seed.
   */
  function vnoise(x, z, seed) {
    const ix = Math.floor(x),
      iz = Math.floor(z),
      fx = x - ix,
      fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx),
      uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed),
      b = hash2(ix + 1, iz, seed),
      c = hash2(ix, iz + 1, seed),
      d = hash2(ix + 1, iz + 1, seed);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  /**
   * Average layers of value noise, halving the weight at each finer scale.
   * @param {number} x - First-octave X.
   * @param {number} z - First-octave Z.
   * @param {number} oct - Positive integer octave count.
   * @param {number} seed - Integer sample seed.
   */
  function fbm(x, z, oct, seed) {
    let s = 0,
      a = 0.5,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * vnoise(x, z, seed + i * 17);
      n += a;
      a *= 0.5;
      x = x * 2.03 + 11.7;
      z = z * 2.03 - 5.3;
    }
    return s / n;
  }
  /**
   * Layer sharp crests where the underlying value noise crosses its midpoint.
   * @param {number} x - First-octave X.
   * @param {number} z - First-octave Z.
   * @param {number} oct - Positive integer octave count.
   * @param {number} seed - Integer sample seed.
   */
  function ridged(x, z, oct, seed) {
    let s = 0,
      a = 0.5,
      n = 0;
    for (let i = 0; i < oct; i++) {
      const v = 1 - Math.abs(vnoise(x, z, seed + i * 31) * 2 - 1);
      s += a * v * v;
      n += a;
      a *= 0.5;
      x = x * 2.1 + 3.1;
      z = z * 2.1 + 8.9;
    }
    return s / n;
  }
  /**
   * Sample smooth noise that repeats after a whole number of lattice cells.
   * @param {number} x - Horizontal lattice coordinate.
   * @param {number} y - Vertical lattice coordinate.
   * @param {number} per - Positive integer period along X.
   * @param {number} seed - Integer sample seed.
   * @param {number} [perY] - Vertical period in cells. Defaults to per.
   */
  function tnoise(x, y, per, seed, perY = per) {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % per) + per) % per,
      x1 = (x0 + 1) % per,
      y0 = ((iy % perY) + perY) % perY,
      y1 = (y0 + 1) % perY;
    const a = hash2(x0, y0, seed),
      b = hash2(x1, y0, seed),
      c = hash2(x0, y1, seed),
      d = hash2(x1, y1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  /**
   * Layer tileable noise in UV space. Adding one to u or v repeats the same sample.
   * @param {number} u - Horizontal texture coordinate.
   * @param {number} v - Vertical texture coordinate.
   * @param {number} per - Positive integer first-octave cell count per tile.
   * @param {number} oct - Positive integer octave count.
   * @param {number} seed - Integer sample seed.
   */
  function tfbm(u, v, per, oct, seed) {
    let s = 0,
      a = 0.5,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * tnoise(u * per, v * per, per, seed + i * 13);
      n += a;
      a *= 0.5;
      per *= 2;
    }
    return s / n;
  }
  return { fbm, ridged, tfbm, tnoise, vnoise };
}

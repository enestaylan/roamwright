/**
 * Seeded two-dimensional noise for terrain heights and seamless textures.
 * @module
 */

import { createHash } from './random.js';

/**
 * Create a family of noise samplers that share a world seed. Use `fbm` for
 * layered terrain, `ridged` for crests and `tfbm` for seamless textures.
 * @param worldSeed - Integer offset shared by the samplers. Each sample also accepts its own seed.
 */
export function createNoise(worldSeed = 0) {
  const hash2 = createHash(worldSeed);
  // Value noise in 0..1, smooth between the integer grid points.
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
  // Fractal noise: oct octaves of value noise, each twice as fine and half as strong.
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
  // Ridged fractal noise: sharp crests where the noise crosses its middle, for ridges and veins.
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
  // Tileable noise for textures: it repeats every `per` cells (every `perY` along y, where the cells are not square).
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
  // Fractal noise that tiles with period per, for seamless textures.
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

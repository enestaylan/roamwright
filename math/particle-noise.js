import { clamp } from './scalar.js';
import { createNoise } from './noise.js';

// The effects' noise sheet, shared by every sprite. R: billowing lumps with creases between them; G, B: the
// slope of R, so a sprite can be shaded as if it had relief; A: a softer cloud that frays edges and drives the flames. R's slope
// needs its neighbours, so the sheet is worked out whole first, in its own rows (lowest first), as whole bytes.
export function particleNoise({ size: N = 256, ridgeSeed = 311, cloudSeed = 733, noise = createNoise() } = {}) {
  const { tfbm, tnoise } = noise;
  const H = new Float32Array(N * N),
    d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N,
        v = (y + 0.5) / N;
      let h = 0,
        a = 0.5,
        n = 0,
        per = 3;
      for (let o = 0; o < 4; o++) {
        h += a * Math.abs(tnoise(u * per, v * per, per, ridgeSeed + o * 17) * 2 - 1);
        n += a;
        a *= 0.5;
        per *= 2;
      }
      H[y * N + x] = clamp((h / n) * 1.9, 0, 1);
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x,
        k = i * 4,
        xm = (x + N - 1) % N,
        xp = (x + 1) % N,
        ym = (y + N - 1) % N,
        yp = (y + 1) % N;
      d[k] = H[i] * 255;
      d[k + 1] = clamp(0.5 + (H[y * N + xp] - H[y * N + xm]) * 5, 0, 1) * 255;
      d[k + 2] = clamp(0.5 + (H[yp * N + x] - H[ym * N + x]) * 5, 0, 1) * 255;
      d[k + 3] = clamp((tfbm((x + 0.5) / N, (y + 0.5) / N, 5, 4, cloudSeed) - 0.5) * 1.7 + 0.5, 0, 1) * 255;
    }
  // fillPixels writes the row of v from the top down; the sheet's row y is read as the card's row y
  return (u, v, out) => {
    const k = ((N - 1 - Math.floor(v * N)) * N + Math.floor(u * N)) * 4;
    out[0] = d[k];
    out[1] = d[k + 1];
    out[2] = d[k + 2];
    out[3] = d[k + 3];
  };
}

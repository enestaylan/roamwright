import { clamp } from './scalar.js';
import { createNoise } from './noise.js';

// The effects' noise sheet, shared by every sprite. R: billowing lumps with creases between them; G, B: the
// slope of R, so a sprite can be shaded as if it had relief; A: a softer cloud that frays edges and drives the flames. R's slope
// needs its neighbours, so the sheet is worked out whole first, in its own rows (lowest first), as whole bytes.
export function particleNoise({ size: size = 256, ridgeSeed = 311, cloudSeed = 733, noise = createNoise() } = {}) {
  const { tfbm, tnoise } = noise;
  const heightSamples = new Float32Array(size * size),
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      let h = 0,
        amplitude = 0.5,
        n = 0,
        per = 3;
      for (let o = 0; o < 4; o++) {
        h += amplitude * Math.abs(tnoise(u * per, v * per, per, ridgeSeed + o * 17) * 2 - 1);
        n += amplitude;
        amplitude *= 0.5;
        per *= 2;
      }
      heightSamples[y * size + x] = clamp((h / n) * 1.9, 0, 1);
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        k = i * 4,
        xm = (x + size - 1) % size,
        xp = (x + 1) % size,
        ym = (y + size - 1) % size,
        yp = (y + 1) % size;
      pixels[k] = heightSamples[i] * 255;
      pixels[k + 1] = clamp(0.5 + (heightSamples[y * size + xp] - heightSamples[y * size + xm]) * 5, 0, 1) * 255;
      pixels[k + 2] = clamp(0.5 + (heightSamples[yp * size + x] - heightSamples[ym * size + x]) * 5, 0, 1) * 255;
      pixels[k + 3] = clamp((tfbm((x + 0.5) / size, (y + 0.5) / size, 5, 4, cloudSeed) - 0.5) * 1.7 + 0.5, 0, 1) * 255;
    }
  // fillPixels writes the row of v from the top down; the sheet's row y is read as the card's row y
  return (u, v, out) => {
    const k = ((size - 1 - Math.floor(v * size)) * size + Math.floor(u * size)) * 4;
    out[0] = pixels[k];
    out[1] = pixels[k + 1];
    out[2] = pixels[k + 2];
    out[3] = pixels[k + 3];
  };
}

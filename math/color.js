import { clamp } from './scalar.js';

const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const SRGB2LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB2LIN[i] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
// Three.js ACES filmic fit (see licenses/three.txt and licenses/baking-lab.txt).
// Mutates a linear RGB color so fog applied after tone mapping can match the sky.
function acesToColor(c, exposure) {
  const r = (c.r * exposure) / 0.6,
    g = (c.g * exposure) / 0.6,
    b = (c.b * exposure) / 0.6;
  let r2 = 0.59719 * r + 0.35458 * g + 0.04823 * b,
    g2 = 0.076 * r + 0.90834 * g + 0.01566 * b,
    b2 = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const f = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  r2 = f(r2);
  g2 = f(g2);
  b2 = f(b2);
  c.r = clamp(1.60475 * r2 - 0.53108 * g2 - 0.07367 * b2, 0, 1);
  c.g = clamp(-0.10208 * r2 + 1.10813 * g2 - 0.00605 * b2, 0, 1);
  c.b = clamp(-0.00327 * r2 - 0.07276 * g2 + 1.07602 * b2, 0, 1);
  return c;
}

export { acesToColor, dim, SRGB2LIN };

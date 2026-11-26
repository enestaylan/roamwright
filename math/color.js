import { clamp } from './scalar.js';

const dim = (color, scale) => [color[0] * scale, color[1] * scale, color[2] * scale];

const SRGB2LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const channel = i / 255;
  SRGB2LIN[i] = channel < 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}
// Three.js ACES filmic fit (see licenses/three.txt and licenses/baking-lab.txt).
// Mutates a linear RGB color so fog applied after tone mapping can match the sky.
function acesToColor(color, exposure) {
  const red = (color.r * exposure) / 0.6,
    green = (color.g * exposure) / 0.6,
    blue = (color.b * exposure) / 0.6;
  let r2 = 0.59719 * red + 0.35458 * green + 0.04823 * blue,
    g2 = 0.076 * red + 0.90834 * green + 0.01566 * blue,
    b2 = 0.0284 * red + 0.13383 * green + 0.83777 * blue;
  const f = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  r2 = f(r2);
  g2 = f(g2);
  b2 = f(b2);
  color.r = clamp(1.60475 * r2 - 0.53108 * g2 - 0.07367 * b2, 0, 1);
  color.g = clamp(-0.10208 * r2 + 1.10813 * g2 - 0.00605 * b2, 0, 1);
  color.b = clamp(-0.00327 * r2 - 0.07276 * g2 + 1.07602 * b2, 0, 1);
  return color;
}

export { acesToColor, dim, SRGB2LIN };

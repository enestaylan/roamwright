import { creasedSheet } from './creased-sheet.js';
import { sampleSurface } from './sampled-surface.js';
import { dim } from '../math/color.js';
import { sstep, TAU } from '../math/scalar.js';

// A stuffed linen case, from the underside through the welt to the crown.
// The pillow's filling banks up around the hollow. The straw tick has a broad, level top under the cover.
const PILLOW = [
  [0, 0],
  [0.78, 0.02],
  [0.94, 0.29],
  [1, 0.43],
  [1.02, 0.46],
  [0.99, 0.5],
  [0.88, 0.78],
  [0.64, 1],
  [0.36, 0.94],
  [0.17, 0.74],
  [0, 0.66],
];
const TICK = [
  [0, 0],
  [0.93, 0],
  [0.99, 0.2],
  [1, 0.68],
  [0.98, 0.91],
  [0.91, 1],
  [0, 1],
];

/** Append a seamed cushion above its base centre. Dimensions are in metres, yaw is in radians and tone is linear RGB. */
function linenCase(cloth, x, y, z, width, height, length, tone, yaw = 0, profile = PILLOW) {
  const pillow = profile === PILLOW,
    rows = [],
    colors = [],
    sin = Math.sin(yaw),
    cos = Math.cos(yaw);
  for (const [radius, level] of profile) {
    const row = [],
      shades = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i * TAU) / 32,
        cosAngle = Math.cos(angle),
        sinAngle = Math.sin(angle);
      // Rounded corners with a little more filling at the four ears of a pillowcase.
      const power = pillow ? 4 : 10;
      const r = radius / Math.pow(Math.abs(cosAngle) ** power + Math.abs(sinAngle) ** power, 1 / power);
      const u = (cosAngle * r * width) / 2,
        v = (sinAngle * r * length) / 2;
      const tuck = pillow ? Math.sin(2 * angle + 0.15) ** 2 * radius ** 3 : 0;
      row.push([x + cos * u + sin * v, y + height * (level + 0.12 * tuck), z - sin * u + cos * v]);
      shades.push(dim(tone, pillow && level === 0.43 ? 0.65 : 1 - 0.07 * tuck));
    }
    rows.push(row);
    colors.push(shades);
  }
  creasedSheet(cloth, rows, colors, { wrap: true, inside: true });
}

/**
 * Append a mattress, cover and pillows to a geometry builder. The centre (x, y, z)
 * is the top of the mattress. The mattress extends down by `tick` and the cover
 * hangs by `drop`. Dimensions are in metres, colours are linear RGB and yaw is in radians.
 */
function bedLinen(cloth, x, y, z, { width, length, tick, cover, drop, coverTone, linen, ticking, pillows = 1, yaw = 0 }) {
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw),
    point = (u, h, v) => [x + cos * u + sin * v, y + h, z - sin * u + cos * v];
  linenCase(cloth, x, y - tick, z, width, tick - 0.008, length, ticking, yaw, TICK);

  // The last two strips at each side and at the foot turn down over the tick. Folds widen towards the free hem.
  sampleSurface(
    cloth,
    24,
    18,
    (u, v) => {
      const across = (2 * u - 1) * 1.2,
        along = v * 1.125,
        side = Math.max(0, (Math.abs(across) - 1) * 5),
        foot = Math.max(0, (along - 1) * 8),
        hang = Math.max(side, foot),
        lateral = Math.max(-1, Math.min(1, across)),
        longitudinal = Math.min(1, along),
        edge = sstep(0.54, 1, Math.abs(across)),
        toe = sstep(0.72, 1, along),
        fold = Math.sin(along * 23 + 1.6 * lateral + 0.72 * Math.sin(along * 9)),
        fan = Math.cos(across * 16 + 1.1 * Math.sin(across * 8) + 1.5 * foot),
        turned = Math.max(0, 1 - Math.abs(along - 0.125) * 13);
      return point(
        (lateral * width) / 2 + Math.sign(across) * side * (0.05 + drop * (0.17 + 0.16 * fold)),
        -drop * hang * (1 - 0.13 * fold * side - 0.12 * fan * foot) + 0.021 * (edge * (1 + fold) + toe * (1 + fan)) + 0.028 * turned,
        length / 2 -
          cover * (1 - longitudinal) +
          0.023 * Math.sin(3 * across + 0.8) * (1 - longitudinal) +
          foot * (0.045 + drop * (0.15 + 0.15 * fan)),
      );
    },
    (u, v) => dim(coverTone, v < 0.112 ? 1.22 : v < 0.166 ? 0.86 : 1),
  );

  const pillowZ = -length / 2 + length * 0.173;
  for (let i = 0; i < pillows; i++) {
    const px = ((i + 0.5) / pillows - 0.5) * width,
      [cx, cy, cz] = point(px, -0.01, pillowZ);
    linenCase(
      cloth,
      cx,
      cy,
      cz,
      width * (pillows === 1 ? 0.79 : 0.46),
      (width / pillows) * 0.21,
      length * 0.218,
      linen,
      yaw + (i === 0 ? -0.045 : 0.07),
    );
  }
}

/** Append a two-sided cloth canopy between side rails at height y. Width and length are in metres. */
function bedCanopy(cloth, x, y, z, width, length, silk) {
  const fall = (u, v) => Math.sin(Math.PI * u) * (0.12 * v + Math.sin(Math.PI * v) * (0.15 + 0.018 * Math.cos(4 * Math.PI * v)));
  sampleSurface(cloth, 16, 12, (u, v) => [x + (u - 0.5) * width, y - fall(u, v), (v - 0.5) * length + z], silk, { back: dim(silk, 0.85) });
  sampleSurface(
    cloth,
    32,
    4,
    (u, v) => {
      const span = Math.sin(Math.PI * u),
        gathers = Math.cos(u * TAU * 7);
      return [
        x + (u - 0.5) * width,
        y - fall(u, 1) - v * (0.11 + 0.17 * span + 0.019 * gathers),
        z + length / 2 + v * (0.016 + 0.023 * gathers) * span,
      ];
    },
    (u, v) => dim(silk, v > 0.75 ? 1.22 : 0.96),
    { back: dim(silk, 0.78) },
  );
}

export { bedLinen, linenCase, bedCanopy };

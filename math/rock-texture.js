import { createNoise } from './noise.js';
import { createHash } from './random.js';
import { cellEdge } from './cell-edge.js';
import { clamp, sstep } from './scalar.js';

// R grain, G cracks (the edges of angular fragments, at two sizes), B blotches (lichen, streaks)
export function createRockTexture(seed = 0) {
  const hash2 = createHash(seed);
  const { tfbm } = createNoise(seed);
  return (u, v, o) => {
    const n = tfbm(u, v, 6, 6, 81),
      w = tfbm(u, v, 4, 3, 82) - 0.5;
    const e1 = cellEdge(hash2, u + w * 0.05, v - w * 0.03, 5, 83),
      e2 = cellEdge(hash2, u - w * 0.03, v + w * 0.05, 13, 84);
    o[0] = clamp(255 * (n * 1.25 - 0.12), 0, 255);
    o[1] =
      255 *
      Math.max(
        sstep(0.014, 0.003, e1) * sstep(0.55, 0.66, tfbm(u, v, 5, 2, 86)),
        0.5 * sstep(0.009, 0.002, e2) * sstep(0.66, 0.74, tfbm(u, v, 7, 2, 87)),
      );
    o[2] = 255 * tfbm(u, v, 4, 5, 85);
  };
}

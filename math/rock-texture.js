import { createNoise } from './noise.js';
import { createHash } from './random.js';
import { cellEdge } from './cell-edge.js';
import { clamp, sstep } from './scalar.js';

// A family of roughly parallel traces. Whole cycles across U and V keep the tile seamless.
// The offset belongs to the joint along its entire length, so spacing varies without crossing its neighbours.
function fractureLine(coordinate, count, hash, salt, width) {
  const id = Math.round(coordinate);
  const wrapped = (id % count + count) % count;
  const gap = Math.abs(coordinate - id - (hash(wrapped, 0, salt) - 0.5) * 0.63);
  return 1 - sstep(width * 0.28, width, gap);
}

// R grain, G fractures, B weathering.
export function createRockTexture(seed = 0, { fractures = 'cells' } = {}) {
  const hash2 = createHash(seed);
  const { tfbm } = createNoise(seed);
  const jointed = fractures === 'joints';
  if (!jointed && fractures !== 'cells') throw new TypeError('Unknown rock fracture pattern: ' + fractures);
  return (u, v, output) => {
    const grainNoise = tfbm(u, v, 6, 6, 81),
      w = tfbm(u, v, 4, 3, 82) - 0.5;
    output[0] = clamp(255 * (grainNoise * 1.25 - 0.12), 0, 255);
    if (jointed) {
      const warp = w * 0.22 + (grainNoise - 0.5) * 0.08;
      // Independently spaced vertical joints stop in competent beds; the oblique set only opens in patches.
      const trace = u * 7 + 0.17 * Math.sin(v * Math.PI * 2) + warp;
      const joint = (Math.round(trace) % 7 + 7) % 7;
      const bedCoordinate = v * 6 + 0.34 * Math.sin(u * Math.PI * 2) + w * 0.46;
      const lower = Math.floor(bedCoordinate), bed = (lower % 6 + 6) % 6;
      const fraction = bedCoordinate - lower;
      const intact = hash2(joint, bed, 90);
      const previous = hash2(joint, (bed + 5) % 6, 90);
      const opening = sstep(0.22, 0.56, previous + (intact - previous) * sstep(0.0, 0.19, fraction));
      const steep = fractureLine(trace, 7, hash2, 83, 0.055);
      const cross = fractureLine(u * 3 - v * 3 - warp, 3, hash2, 84, 0.044);
      const seam = fractureLine(bedCoordinate, 6, hash2, 85, 0.065);
      const open = tfbm(u, v, 4, 2, 86);
      const crossOpen = tfbm(u, v, 3, 2, 87);
      output[1] = 255 * Math.max(
        steep * opening * sstep(0.37, 0.61, open),
        cross * sstep(0.53, 0.76, crossOpen) * 0.64,
        seam * sstep(0.36, 0.72, crossOpen) * 0.60,
      );
    } else {
      const e1 = cellEdge(hash2, u + w * 0.05, v - w * 0.03, 5, 83);
      const e2 = cellEdge(hash2, u - w * 0.03, v + w * 0.05, 13, 84);
      output[1] = 255 * Math.max(
        sstep(0.014, 0.003, e1) * sstep(0.55, 0.66, tfbm(u, v, 5, 2, 86)),
        0.5 * sstep(0.009, 0.002, e2) * sstep(0.66, 0.74, tfbm(u, v, 7, 2, 87)),
      );
    }
    output[2] = 255 * tfbm(u, v, 4, 5, 85);
  };
}

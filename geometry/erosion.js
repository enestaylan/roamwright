/**
 * Shape a square terrain heightfield with seeded hydraulic erosion while protecting selected vertices.
 * @module
 */

import { lerp, sstep } from '../math/scalar.js';

// Weights in a circular erosion brush sum to one, including a fractional radius.
function erosionBrush(radius) {
  const cells = [],
    r = Math.ceil(radius);
  let sum = 0;
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      const w = Math.max(0, radius - Math.hypot(di, dj));
      if (w > 0) {
        cells.push(di, dj, w);
        sum += w;
      }
    }
  for (let c = 2; c < cells.length; c += 3) cells[c] /= sum;
  return cells;
}

/**
 * Move sediment downhill by simulating droplets. The height buffer is modified
 * in place. Reuse the original heights and reset the random generator to reproduce a bake.
 * @param {Float32Array | Float64Array | number[]} heights - Row-major elevations, indexed by row × width + column.
 * @param {number} width - Vertices per side of the square grid, at least four.
 * @param {ArrayLike<number>} mask - One influence per vertex. Zero preserves the starting elevation, one allows full erosion.
 * @param {() => number} rng - Random stream in [0, 1), such as `mulberry32(seed)`.
 * @param {object} options - Droplet simulation settings.
 * @param {number} options.drops - Number of droplets to attempt.
 * @param {number} options.lifetime - Maximum steps per droplet. Each step travels one grid cell.
 * @param {number} options.inertia - Fraction of the previous direction retained in the next step.
 * @param {number} options.capacityFactor - Scales the sediment load supported by downhill speed and water volume.
 * @param {number} options.minCapacity - Lower bound on the supported sediment load.
 * @param {number} options.erosionRate - Fraction of spare capacity to erode per step, capped by the local fall.
 * @param {number} options.depositRate - Fraction of excess sediment deposited on a downhill step.
 * @param {number} options.evaporation - Fraction of remaining water lost per step.
 * @param {number} options.gravity - Converts the change in elevation into a change in squared speed.
 * @param {number} options.radius - Positive erosion brush radius in grid cells.
 * @param {number} options.maxChange - Maximum absolute deviation from each vertex’s initial elevation, in height units.
 */
export function erodeHeightfield(heights, width, mask, rng, options) {
  const { drops, lifetime, inertia, capacityFactor, minCapacity, erosionRate,
    depositRate, evaporation, gravity, radius, maxChange } = options;
  if (!Number.isInteger(width) || width < 4 || heights.length !== width * width || mask.length !== heights.length) {
    throw new RangeError('height and mask grids must match the square width');
  }
  if (!(radius > 0)) throw new RangeError('radius must be positive');
  const last = width - 1, start = heights.slice(), brush = erosionBrush(radius);
  const hg = [0, 0, 0]; // height and its slope across and along at a point, worked out by heightGrad
  // the height at (px, py) in cells, and its gradient, from the four cells round it
  const heightGrad = (px, py) => {
    const i = px | 0,
      j = py | 0,
      u = px - i,
      v = py - j,
      k = j * width + i,
      a = heights[k],
      b = heights[k + 1],
      c = heights[k + width],
      d = heights[k + width + 1];
    hg[0] = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    hg[1] = (b - a) * (1 - v) + (d - c) * v;
    hg[2] = (c - a) * (1 - u) + (d - b) * u;
  };
  const change = (k, amount) => {
    const h = heights[k] + amount * mask[k];
    heights[k] = Math.min(Math.max(h, start[k] - maxChange), start[k] + maxChange);
  };
  for (let n = 0; n < drops; n++) {
    let px = 1 + rng() * (last - 2),
      py = 1 + rng() * (last - 2);
    if (mask[(py | 0) * width + (px | 0)] <= 0) continue;
    let dx = 0,
      dy = 0,
      speed = 1,
      water = 1,
      carried = 0;
    for (let life = 0; life < lifetime; life++) {
      const i = px | 0,
        j = py | 0,
        u = px - i,
        v = py - j,
        k = j * width + i;
      heightGrad(px, py);
      const h = hg[0];
      dx = dx * inertia - hg[1] * (1 - inertia);
      dy = dy * inertia - hg[2] * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) break; // a hollow: the drop stands and soaks away
      dx /= len;
      dy /= len;
      px += dx;
      py += dy;
      if (px < 1 || py < 1 || px >= last - 1 || py >= last - 1) break;
      heightGrad(px, py);
      const fall = h - hg[0], // positive downhill
        capacity = Math.max(fall * speed * water * capacityFactor, minCapacity);
      if (fall < 0 || carried > capacity) {
        // uphill it fills the hollow it came out of; over its capacity it lays some down: both at the cell it left, by its corners
        const laid = fall < 0 ? Math.min(-fall, carried) : (carried - capacity) * depositRate;
        carried -= laid;
        change(k, laid * (1 - u) * (1 - v));
        change(k + 1, laid * u * (1 - v));
        change(k + width, laid * (1 - u) * v);
        change(k + width + 1, laid * u * v);
      } else {
        // under its capacity it wears the ground round the cell it left, never deeper than its own fall
        const worn = Math.min((capacity - carried) * erosionRate, fall);
        for (let c = 0; c < brush.length; c += 3) {
          const bi = i + brush[c],
            bj = j + brush[c + 1];
          if (bi < 0 || bj < 0 || bi > last || bj > last) continue;
          const bk = bj * width + bi,
            take = worn * brush[c + 2] * mask[bk];
          change(bk, -worn * brush[c + 2]);
          carried += take;
        }
      }
      speed = Math.sqrt(Math.max(speed * speed + fall * gravity, 0));
      water *= 1 - evaporation;
    }
  }
  // the worn ground is eased into the laid-out ground at the edge of the wild, so nothing steps where the mask fades
  for (let k = 0; k < heights.length; k++) heights[k] = lerp(start[k], heights[k], sstep(0, 0.35, mask[k]));
}

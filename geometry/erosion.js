/**
 * Shape a square terrain heightfield with seeded hydraulic erosion while protecting selected vertices.
 * @module
 */

import { lerp, sstep } from '../math/scalar.js';

// Weights in a circular erosion brush sum to one, including a fractional radius.
function erosionBrush(radius) {
  const cells = [],
    brushExtent = Math.ceil(radius);
  let sum = 0;
  for (let dj = -brushExtent; dj <= brushExtent; dj++)
    for (let di = -brushExtent; di <= brushExtent; di++) {
      const w = Math.max(0, radius - Math.hypot(di, dj));
      if (w > 0) {
        cells.push(di, dj, w);
        sum += w;
      }
    }
  for (let weightOffset = 2; weightOffset < cells.length; weightOffset += 3) cells[weightOffset] /= sum;
  return cells;
}

/**
 * Move sediment downhill by simulating droplets. The height buffer is modified
 * in place. Reuse the original heights and reset the random generator to reproduce a bake.
 * @param {Float32Array | Float64Array | number[]} heights - Row-major elevations, indexed by row × width + column.
 * @param {number} width - Vertices per side of the square grid, at least four.
 * @param {ArrayLike<number>} mask - One influence per vertex. Zero preserves the starting elevation, one allows full erosion.
 * @param {() => number} random - Random stream in [0, 1), such as `mulberry32(seed)`.
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
export function erodeHeightfield(heights, width, mask, random, options) {
  const { drops, lifetime, inertia, capacityFactor, minCapacity, erosionRate,
    depositRate, evaporation, gravity, radius, maxChange } = options;
  if (!Number.isInteger(width) || width < 4 || heights.length !== width * width || mask.length !== heights.length) {
    throw new RangeError('height and mask grids must match the square width');
  }
  if (!(radius > 0)) throw new RangeError('radius must be positive');
  const last = width - 1, start = heights.slice(), brush = erosionBrush(radius);
  const heightAndGradient = [0, 0, 0]; // height and its slope across and along at a point, worked out by heightGrad
  // the height at (px, py) in cells, and its gradient, from the four cells round it
  const heightGrad = (px, py) => {
    const i = px | 0,
      j = py | 0,
      u = px - i,
      v = py - j,
      cellIndex = j * width + i,
      nearLeft = heights[cellIndex],
      nearRight = heights[cellIndex + 1],
      farLeft = heights[cellIndex + width],
      farRight = heights[cellIndex + width + 1];
    heightAndGradient[0] = nearLeft * (1 - u) * (1 - v) + nearRight * u * (1 - v) + farLeft * (1 - u) * v + farRight * u * v;
    heightAndGradient[1] = (nearRight - nearLeft) * (1 - v) + (farRight - farLeft) * v;
    heightAndGradient[2] = (farLeft - nearLeft) * (1 - u) + (farRight - nearRight) * u;
  };
  const change = (cellIndex, amount) => {
    const adjustedHeight = heights[cellIndex] + amount * mask[cellIndex];
    heights[cellIndex] = Math.min(Math.max(adjustedHeight, start[cellIndex] - maxChange), start[cellIndex] + maxChange);
  };
  for (let droplet = 0; droplet < drops; droplet++) {
    let px = 1 + random() * (last - 2),
      py = 1 + random() * (last - 2);
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
        cellIndex = j * width + i;
      heightGrad(px, py);
      const previousHeight = heightAndGradient[0];
      dx = dx * inertia - heightAndGradient[1] * (1 - inertia);
      dy = dy * inertia - heightAndGradient[2] * (1 - inertia);
      const directionLength = Math.hypot(dx, dy);
      if (directionLength < 1e-6) break; // a hollow: the drop stands and soaks away
      dx /= directionLength;
      dy /= directionLength;
      px += dx;
      py += dy;
      if (px < 1 || py < 1 || px >= last - 1 || py >= last - 1) break;
      heightGrad(px, py);
      const fall = previousHeight - heightAndGradient[0], // positive downhill
        capacity = Math.max(fall * speed * water * capacityFactor, minCapacity);
      if (fall < 0 || carried > capacity) {
        // uphill it fills the hollow it came out of; over its capacity it lays some down: both at the cell it left, by its corners
        const laid = fall < 0 ? Math.min(-fall, carried) : (carried - capacity) * depositRate;
        carried -= laid;
        change(cellIndex, laid * (1 - u) * (1 - v));
        change(cellIndex + 1, laid * u * (1 - v));
        change(cellIndex + width, laid * (1 - u) * v);
        change(cellIndex + width + 1, laid * u * v);
      } else {
        // under its capacity it wears the ground round the cell it left, never deeper than its own fall
        const worn = Math.min((capacity - carried) * erosionRate, fall);
        for (let brushOffset = 0; brushOffset < brush.length; brushOffset += 3) {
          const bi = i + brush[brushOffset],
            bj = j + brush[brushOffset + 1];
          if (bi < 0 || bj < 0 || bi > last || bj > last) continue;
          const brushIndex = bj * width + bi,
            take = worn * brush[brushOffset + 2] * mask[brushIndex];
          change(brushIndex, -worn * brush[brushOffset + 2]);
          carried += take;
        }
      }
      speed = Math.sqrt(Math.max(speed * speed + fall * gravity, 0));
      water *= 1 - evaporation;
    }
  }
  // the worn ground is eased into the laid-out ground at the edge of the wild, so nothing steps where the mask fades
  for (let cellIndex = 0; cellIndex < heights.length; cellIndex++) heights[cellIndex] = lerp(start[cellIndex], heights[cellIndex], sstep(0, 0.35, mask[cellIndex]));
}

/**
 * Build river ribbons from a centreline, a water level and a sampled bed.
 * @module
 */

import * as THREE from 'three';
import { clamp, lerp, sstep } from '../math/scalar.js';

const DEEP = 8, // the depth the shader takes for water that knows no bed
  FAR = 99, // how far from a spring's eye water is that has none
  MURK = 7, // a stream's water hides its bed this many times sooner than the lake's
  ACROSS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1], // where a cross-section's vertices lie, as shares of its half width
  SPRING = { grows: 3, rill: 0.2, pool: 0.1, eye: 0.43, size: 0.31, tip: 0.35, fade: 0.2 }; // lengths in stream widths, widths as shares of the half width
// The share of its half width a ribbon has `run` metres from its spring.
function headShare(run, width, grows) {
  const rill = lerp(SPRING.rill, 1, sstep(0, grows, run)),
    pool = SPRING.pool * Math.exp(-(((run - springEye(width)) / (SPRING.size * width)) ** 2));
  return (rill + pool) * Math.sqrt(clamp(run / (SPRING.tip * width), 0, 1));
}
// Past the first ground that stands out of the water there is none, whatever lies beyond (the land may fall away again behind
// a bank): walks the cross-section that starts at vertex `first` from its middle to each side, and takes the water away after
// the first bank.
const MIDDLE = ACROSS.indexOf(0),
  DRY = -1;
function shutBeyondBanks(bank, first) {
  for (const step of [-1, 1]) {
    let dry = false;
    for (let k = MIDDLE + step; k >= 0 && k < ACROSS.length; k += step) {
      const depth = (first + k) * 4;
      if (dry) bank[depth] = Math.min(bank[depth], DRY);
      else dry = bank[depth] < 0;
    }
  }
}
/**
 * Build an indexed ribbon from spring to mouth. The ribbon starts at a point
 * and widens downstream. When terrain is supplied, the water shader clips the
 * ribbon at the first raised bank on each side of a cross-section.
 * @param {[number, number][]} pts - At least two downstream-ordered [x, z] points in metres.
 * @param {number} width - Full stream width in metres once the channel has widened.
 * @param {(t: number) => number} surface - Water elevation in metres at `t = i / (pts.length - 1)`.
 *   Samples are spaced by point index. Unevenly spaced points get equal increments in t.
 * @param {ArrayLike<number>} bed - One bed elevation per point. The local drop drives the flow shader.
 * @param {{ground: (x: number, z: number) => number, reach: number, grows?: number} | null} [banks] -
 *   Terrain elevation sampler, extra reach on each bank in metres and optional downstream widening distance.
 * @param {((x: number, z: number) => number) | null} [fadeAt] - Visible share (0–1) along the centreline,
 *   useful where the stream meets a lake.
 * @returns An owned BufferGeometry with position, flow, current and bank attributes for the stream material.
 * @example
 * ```js
 * import { streamGeometry } from 'roamwright/geometry/stream.js';
 *
 * const channel = [[0, 0], [1, 8], [3, 16]];
 * const water = streamGeometry(channel, 4, t => 3 - t, [2.4, 1.8, 1.2]);
 * // Pass water to a mesh using the stream material, then dispose it on removal.
 * water.dispose();
 * ```
 */
export function streamGeometry(pts, width, surface, bed, banks = null, fadeAt = null) {
  const n = pts.length,
    across = ACROSS.length,
    pos = new Float32Array(n * across * 3),
    flow = new Float32Array(n * across * 3),
    current = new Float32Array(n * across * 2),
    bank = new Float32Array(n * across * 4),
    idx = [],
    reach = width * 0.5 + (banks ? banks.reach : 0),
    grows = banks?.grows ?? SPRING.grows * width;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0],
      dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (i > 0) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const y = surface(i / (n - 1)),
      grade = sstep(0.015, 0.32, (bed[Math.max(i - 3, 0)] - bed[Math.min(i + 3, n - 1)]) / 9),
      share = headShare(run, width, grows),
      rising = sstep(0, SPRING.fade * width, run) * (fadeAt ? fadeAt(pts[i][0], pts[i][1]) : 1);
    for (let k = 0; k < across; k++) {
      const side = ACROSS[k],
        // a strip with no banks to shape it wanders a little in width
        wander = banks
          ? 1
          : 0.89 + 0.09 * Math.sin(run * 0.23 + Math.sign(side) * 1.2) + 0.025 * Math.sin(run * 0.87 - Math.sign(side) * 1.4),
        off = side * reach * share * wander,
        x = pts[i][0] - dz * off,
        z = pts[i][1] + dx * off,
        v = i * across + k;
      pos.set([x, y, z], v * 3);
      flow.set([off / (width * 0.5), run, grade], v * 3);
      current.set([dx, dz], v * 2);
      bank.set(
        [banks ? (y - banks.ground(x, z)) * MURK : DEEP, rising * sstep(1, 0.75, Math.abs(side)), run - springEye(width), off],
        v * 4,
      );
      if (i < n - 1 && k < across - 1) idx.push(v, v + 1, v + across, v + 1, v + across + 1, v + across);
    }
    if (banks) shutBeyondBanks(bank, i * across);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 3));
  g.setAttribute('aCurrent', new THREE.BufferAttribute(current, 2));
  g.setAttribute('aBank', new THREE.BufferAttribute(bank, 4));
  g.setIndex(idx);
  return g;
}

// How far below its spring a stream of this width has the eye of its pool, in metres.
export const springEye = width => SPRING.eye * width;

export { DEEP, FAR };

import * as THREE from 'three';
import { sstep, TAU } from '../math/scalar.js';
import { STRANDS } from './hair-tags.js';
import { POINT } from './hair-patch.js';

const MIDDLE = new THREE.Vector3(0, 0.02, -0.012), // about the middle of the skull's dome: hair stands out from here
  TUCK = 0.8, //         how much of its fullness the mass gives up under a fall of long hair
  EDGE = 0.04, //        how much of its fullness the mass keeps at the hairline itself,
  RISE = 0.16, //        and how far inside the hairline it reaches all of it (as the hairline is measured: 1 is half the head's height)
  DETAIL = 11, //        the shell's fineness: its sides are about 10 mm long, too short to show on the head's outline at 0.9 m
  TURNS = 23, //         periods of strands round the head, about the axis the cut's hair lies away from
  SEAM_STEPS = 9, //     halvings that find where the hairline crosses a side of the shell
  TOO_WIDE = 0.3; //     a triangle wider than this across the strands (of the tag's measure) lies on the pole they part from

const _o = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _e1 = new THREE.Vector3(),
  _e2 = new THREE.Vector3();

// The mass of a cut. scale: how far out from the skull its fullest stands (across, up, fore and aft, as shares of the skull);
// inHair(x, y, z): how far inside the hairline a direction lies; drop: how far it hangs below the ears; lumps: how deep its
// lumps are (a share of the skull) and lumpy: how many there are round the head; tucked(d): where it lies under a fall of long
// hair and is drawn in to the skull, 0 to 1.
// Returns at(d, lift, out, outward): the point of the mass at a direction from the head's middle, raised off it by lift
// (metres), and the way out there; and full(d): how much of its fullness the mass has at a direction, 0 to 1.
function massOf({ skull, scale, inHair, drop = 0, lumps = 0, lumpy = 5, tucked = null }) {
  const full = d => (EDGE + (1 - EDGE) * sstep(-0.01, RISE, inHair(d.x, d.y, d.z))) * (tucked ? 1 - TUCK * tucked(d) : 1),
    swell = d =>
      lumps *
      (Math.sin(d.x * lumpy * 2.3 + d.y * lumpy * 1.3) * Math.sin(d.z * lumpy * 2.1 - d.y * lumpy * 1.7) +
        0.6 * Math.sin(d.y * lumpy * 2.9 + d.x * lumpy * 1.1 - d.z * lumpy * 1.9)),
    at = (d, lift, out, outward = _n) => {
      const k = full(d),
        more = lumps ? swell(d) * k : 0;
      skull.skull(d, out);
      out.set(
        out.x * (1 + (scale[0] - 1) * k + more),
        out.y * (1 + (scale[1] - 1) * k + more) * (d.y < 0 ? 1 + drop : 1),
        out.z * (1 + (scale[2] - 1) * k + more),
      );
      outward.copy(out).sub(MIDDLE).normalize();
      return lift ? out.addScaledVector(outward, lift) : out;
    };
  return { at, full, inHair, skull };
}

// How far across the strands a direction lies, where the hair of a cut lies away from a pole (the crown's whorl, a parting's
// end, the knot hair is drawn back to): the angle round that pole, in the tag's measure, a whole number of periods to the turn.
function roundPole(pole) {
  const axis = new THREE.Vector3(...pole).normalize(),
    e1 = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize(),
    e2 = new THREE.Vector3().crossVectors(axis, e1),
    turn = TURNS * STRANDS.period;
  const across = d => (Math.atan2(d.dot(e2), d.dot(e1)) / TAU) * turn;
  across.turn = turn;
  across.axis = axis;
  return across;
}

// The shell of a mass, cut off at the hairline: its points (their place, normal, how far inside the hairline and how far
// across the strands each lies) and its triangles. Kept by the cut's name.
function createHairShells(sculptMesh) {
  const shells = new Map();
  return function shellOf(key, mass, across) {
    let shell = shells.get(key);
    if (shell) return shell;
    const soup = sculptMesh('mass:' + key, DETAIL, (d, o) => mass.at(d, 0, o)),
      { P, N, D } = soup,
      points = [], // x, y, z, the normal, the direction
      inside = [],
      known = new Map(),
      numbered = new Int32Array(soup.n),
      add = (x, y, z, nx, ny, nz, dx, dy, dz, h) => {
        points.push(x, y, z, nx, ny, nz, dx, dy, dz);
        inside.push(h);
        return inside.length - 1;
      };
    // Shared sphere directions have identical positions along the hairline.
    for (let i = 0; i < soup.n; i++) {
      const q = i * 3,
        at = Math.round(D[q] * 2e4) + ',' + Math.round(D[q + 1] * 2e4) + ',' + Math.round(D[q + 2] * 2e4);
      let v = known.get(at);
      if (v === undefined) {
        v = add(P[q], P[q + 1], P[q + 2], N[q], N[q + 1], N[q + 2], D[q], D[q + 1], D[q + 2], mass.inHair(D[q], D[q + 1], D[q + 2]));
        known.set(at, v);
      }
      numbered[i] = v;
    }
    // where the hairline crosses the side from i (inside) to j: found on the mass itself, and kept for the triangle beyond
    const crossings = new Map(),
      cross = (i, j) => {
        const side = i * inside.length + j;
        let v = crossings.get(side);
        if (v !== undefined) return v;
        let low = 0,
          high = 1;
        const a = i * 9,
          b = j * 9;
        for (let s = 0; s < SEAM_STEPS; s++) {
          const t = (low + high) / 2;
          _d.set(points[a + 6], points[a + 7], points[a + 8])
            .lerp(_e1.set(points[b + 6], points[b + 7], points[b + 8]), t)
            .normalize();
          if (mass.inHair(_d.x, _d.y, _d.z) > 0) low = t;
          else high = t;
        }
        _d.set(points[a + 6], points[a + 7], points[a + 8])
          .lerp(_e1.set(points[b + 6], points[b + 7], points[b + 8]), low)
          .normalize();
        mass.at(_d, 0, _o);
        _e2
          .set(points[a + 3], points[a + 4], points[a + 5])
          .lerp(_e1.set(points[b + 3], points[b + 4], points[b + 5]), low)
          .normalize();
        v = add(_o.x, _o.y, _o.z, _e2.x, _e2.y, _e2.z, _d.x, _d.y, _d.z, 0);
        crossings.set(side, v);
        return v;
      };
    const triangles = [],
      poly = [];
    for (let t = 0; t < soup.n; t += 3) {
      poly.length = 0;
      for (let e = 0; e < 3; e++) {
        const i = numbered[t + e],
          j = numbered[t + ((e + 1) % 3)];
        if (inside[i] > 0) poly.push(i);
        if (inside[i] > 0 !== inside[j] > 0) poly.push(inside[i] > 0 ? cross(i, j) : cross(j, i));
      }
      for (let f = 1; f + 1 < poly.length; f++) triangles.push(poly[0], poly[f], poly[f + 1]);
    }
    // how far across the strands each corner lies: of one mind within a triangle, whichever way round the pole its points lie
    const strands = new Float32Array(triangles.length);
    for (let t = 0; t < triangles.length; t += 3) {
      let most = 0;
      for (let e = 0; e < 3; e++) {
        const p = triangles[t + e] * 9;
        let q = across(_d.set(points[p + 6], points[p + 7], points[p + 8]));
        if (e) {
          q += across.turn * Math.round((strands[t] - q) / across.turn);
          most = Math.max(most, Math.abs(q - strands[t]));
        }
        strands[t + e] = q;
      }
      if (most > TOO_WIDE) strands[t + 1] = strands[t + 2] = strands[t];
    }
    shell = { points: new Float32Array(points), inside: new Float32Array(inside), triangles, strands };
    shells.set(key, shell);
    return shell;
  };
}

// Puts a mass's shell on a head. colour(inside, dx, dy, dz, out): the hair's colour at a point so far inside the hairline.
function placeHairShell(shell, place, colour) {
  const { points, inside, triangles, strands } = shell,
    placed = new Float32Array(triangles.length * POINT),
    corners = new Array(triangles.length),
    v = [0, 0, 0, 0, 0, 0],
    tint = [0, 0, 0];
  // a corner for each triangle's each point: a point shared by triangles that agree on its strands is one point again in the patch
  const same = new Map();
  let count = 0;
  for (let t = 0; t < triangles.length; t++) {
    const p = triangles[t],
      key = p * 8192 + Math.round(strands[t] * 1024) + 4096;
    let at = same.get(key);
    if (at === undefined) {
      at = count++;
      same.set(key, at);
      const q = p * 9,
        k = at * POINT;
      for (let i = 0; i < 6; i++) v[i] = points[q + i];
      place(v);
      colour(inside[p], points[q + 6], points[q + 7], points[q + 8], tint);
      for (let i = 0; i < 6; i++) placed[k + i] = v[i];
      placed[k + 6] = tint[0];
      placed[k + 7] = tint[1];
      placed[k + 8] = tint[2];
      placed[k + 9] = strands[t];
    }
    corners[t] = at;
  }
  return { points: placed.subarray(0, count * POINT), triangles: corners };
}

export { createHairShells, massOf, placeHairShell, roundPole };

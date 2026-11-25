import * as THREE from 'three';
import { lerp, sstep } from '../math/scalar.js';
import { STRANDS } from './hair-tags.js';
import { POINT } from './hair-patch.js';

// ════════════════════════════════════════════════════════════════════════
//  Locks of a near head's hair. A lock is a narrow strip that lies on the mass of the hair (hair-mass.js) along the lie of the
//  cut and curves with it, each a little over the one below as hair lies in layers, lifting only toward its tip; a lock of
//  long hair is combed over the head and hangs over the fall behind. It is drawn as a ribbon that comes to a point, rounded by
//  its normals, its strands running on to its edge. Lengths are metres from the head's middle.
// ════════════════════════════════════════════════════════════════════════
const FACE_EDGE = 0.028, // below the hairline no hair lies further forward than this: it lies beside the face, not over it
  HAIRLINE = 0.035,
  SHOULDER_DEEP = 0.13, // half the depth of the shoulders, fore and aft
  ROOT_SHADE = 0.94, // a lock is darker at its root than at its tip
  TIP_SHADE = 1.02,
  EDGE_SHADE = 0.95, // and darker down one edge, as strands lie over one another
  ROUND = 0.08, // how far a ribbon's normals lean out over its edges (radians): it is lit as a round lock
  TIP = 0.1, // a ribbon's width at its tip, of its fullest
  FREE = -1; // the lift of a point that hangs clear of the head

const _p = new THREE.Vector3(),
  _q = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _f = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _dir = new THREE.Vector3();

// Moves a point off the neck and the shoulders (o.neck: how far from the neck's axis; o.shoulder: half the shoulders' breadth).
function clearNeck(p, o) {
  if (p.y < HAIRLINE && p.z > FACE_EDGE) p.z = FACE_EDGE;
  if (p.y >= -0.075) return;
  const low = sstep(-0.14, -0.215, p.y),
    rx = lerp(o.neck, o.shoulder + 0.035, low),
    rz = lerp(o.neck, SHOULDER_DEEP, low),
    z = p.z + 0.012,
    q = Math.hypot(p.x / rx, z / rz);
  if (q < 1) {
    p.x /= q;
    p.z = z / q - 0.012;
  }
}

// The path of a lock that lies on the mass: points [x, y, z, the way out, its lift]. root: a direction from the head's middle
// to where it grows; o: flow(d, out) (the lie of the cut at a direction), aside (how far this lock leans from it), length,
// segs, base, rise and tip (its lift off the mass at the root, how much more by its end, and how far its tip stands up besides,
// metres), wave and coil (how far it winds from side to side and how fast), curl (how far it turns at each step, one way),
// phase, neck and shoulder.
function layLock(mass, root, o) {
  const points = [],
    step = o.length / o.segs;
  _dir.copy(root);
  for (let i = 0; i <= o.segs; i++) {
    const u = i / o.segs,
      lift = o.base + o.rise * u + o.tip * u * u * u;
    mass.at(_dir, lift, _p, _n);
    clearNeck(_p, o);
    points.push([_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, lift]);
    if (i === o.segs) break;
    o.flow(_dir, _f);
    _f.x += o.aside[0];
    _f.z += o.aside[1];
    _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    const turn = (o.wave || 0) * Math.sin(o.phase + i * o.coil) + (o.curl || 0) * (i + 0.5);
    if (turn) _f.applyAxisAngle(_n, turn);
    mass.at(_dir, 0, _q).addScaledVector(_f, step);
    mass.skull.under(_q.x, _q.y, _q.z, _dir);
  }
  return points;
}

// The path of a lock of long hair: combed over the mass from its root to where it leaves the head, behind the ear or at the
// nape, then hanging over the fall of hair down the back. o: round (where round the fall it hangs, as the fall counts angles),
// shape(y) (the fall's half-width, half-depth and middle at a height), from (the height at which it leaves the head, as a
// share of the head's), end (how low it hangs), combed and segs (its lengths over the head and hanging), lift (metres off the mass), sway and phase (how it wavers as it hangs).
function hangLock(mass, root, o) {
  const points = [];
  _d.set(Math.cos(o.round), 0, Math.sin(o.round)).multiplyScalar(Math.sqrt(1 - o.from * o.from));
  _d.y = o.from;
  for (let i = 0; i <= o.combed; i++) {
    const lift = 0.001 + o.lift * Math.sin((i / o.combed) * Math.PI * 0.5);
    mass.at(
      _s
        .copy(root)
        .lerp(_d, i / o.combed)
        .normalize(),
      lift,
      _p,
      _n,
    );
    points.push([_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, lift]);
  }
  const top = _p.y;
  for (let j = 1; j <= o.segs; j++) {
    const t = j / o.segs,
      y = lerp(top, o.end, t),
      [rx, rz, cz] = o.shape(y),
      a = o.round + o.sway * Math.sin(o.phase + j * 1.3) * t,
      out = 0.004 + 0.006 * t;
    _n.set(Math.cos(a) / rx, 0.6, Math.sin(a) / rz).normalize();
    points.push([Math.cos(a) * (rx + out), y, cz + Math.sin(a) * (rz + out), _n.x, _n.y, _n.z, FREE]);
  }
  return points;
}

// Adds a lock's path to a patch ({ points, triangles }: hair-patch.js) as a ribbon of that half-width, fullest a third of the
// way along and drawn to a point. place sets a point of the head in the figure; mass: what its edges lie on, where the path
// does; strand: where across the strands of the head its middle lies (any number: each lock has its own strands).
function drawLock(patch, place, mass, points, half, colour, tone, strand) {
  const last = points.length - 1,
    first = patch.points.length / POINT;
  for (let i = 0; i <= last; i++) {
    const p = points[i],
      a = points[Math.max(0, i - 1)],
      b = points[Math.min(last, i + 1)],
      u = i / last,
      wide = half * (0.4 + 0.6 * Math.sin(Math.min(1, u * 3) * Math.PI * 0.5)) * lerp(1, TIP, Math.pow(u, 1.4)),
      shade = tone * lerp(ROOT_SHADE, TIP_SHADE, u);
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _n.set(p[3], p[4], p[5]);
    _s.crossVectors(_d, _n).normalize();
    for (const k of [-1, 1]) {
      _p.set(p[0] + _s.x * wide * k, p[1] + _s.y * wide * k, p[2] + _s.z * wide * k);
      if (p[6] !== FREE) mass.at(mass.skull.under(_p.x, _p.y, _p.z, _dir), p[6], _p, _q);
      else _q.copy(_n);
      const v = place([
          _p.x,
          _p.y,
          _p.z,
          _q.x * Math.cos(ROUND) + _s.x * Math.sin(ROUND) * k,
          _q.y * Math.cos(ROUND) + _s.y * Math.sin(ROUND) * k,
          _q.z * Math.cos(ROUND) + _s.z * Math.sin(ROUND) * k,
        ]),
        dark = shade * (k < 0 ? EDGE_SHADE : 1);
      patch.points.push(
        v[0],
        v[1],
        v[2],
        v[3],
        v[4],
        v[5],
        colour[0] * dark,
        colour[1] * dark,
        colour[2] * dark,
        strand + (wide / STRANDS.span) * k,
      );
    }
    if (i < last) {
      const at = first + i * 2;
      patch.triangles.push(at, at + 1, at + 3, at, at + 3, at + 2);
    }
  }
}

export { drawLock, hangLock, layLock };

/**
 * Unit meshes, transforms and colour helpers for assembling models with a geometry builder.
 * @module
 */

import * as THREE from 'three';
import { TAU } from '../math/scalar.js';
import { createNoise } from '../math/noise.js';

// ════════════════════════════════════════════════════════════════════════
//  The unit shapes every builder places (U), the matrix that places them (TRS), a colour as a builder takes it (C), and a rod
//  between two points (stick)
// ════════════════════════════════════════════════════════════════════════
const _m4 = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _eu = new THREE.Euler(),
  _sc = new THREE.Vector3(),
  _ps = new THREE.Vector3(),
  _cc = new THREE.Color();
function TRS(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  // returns a shared matrix: use it immediately
  _eu.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_eu);
  return _m4.compose(_ps.set(x, y, z), _q, _sc.set(sx, sy, sz));
}
// A unit triangular prism, the shape of a gable roof.
function prismGeometry() {
  const a = [-0.5, 0, -0.5],
    b = [0.5, 0, -0.5],
    c = [0.5, 0, 0.5],
    d = [-0.5, 0, 0.5],
    e = [0, 1, -0.5],
    f = [0, 1, 0.5];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, d, f, a, f, e, b, e, f, b, f, c, d, c, f, b, a, e].flat(), 3));
  g.computeVertexNormals();
  return g;
}
// The two triangular ends of that prism alone: a gable's wall, under a roof drawn without them.
function gableGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5], 3),
  );
  g.computeVertexNormals();
  return g;
}
// The ways a face can look, as [axis, sign]
const WAYS = { '+x': [0, 1], '-x': [0, -1], '+y': [1, 1], '-y': [1, -1], '+z': [2, 1], '-z': [2, -1] };
// A unit shape without its flat faces that look the ways named ('+x', '-y', ...), the rest in their order: for a part whose faces
// lie against something, where no one can see them (the back of a box fixed to a wall, the foot of a rod set in one)
function without(shape, ...ways) {
  const g = shape.index ? shape.toNonIndexed() : shape,
    p = g.attributes.position.array,
    n = g.attributes.normal.array,
    away = t => ways.some(w => [0, 3, 6].every(k => n[t + k + WAYS[w][0]] * WAYS[w][1] > 0.99)),
    kept = [];
  for (let t = 0; t < p.length; t += 9) if (!away(t)) kept.push(t);
  const pick = a => {
      const out = new Float32Array(kept.length * 9);
      kept.forEach((t, i) => out.set(a.subarray(t, t + 9), i * 9));
      return new THREE.BufferAttribute(out, 3);
    },
    q = new THREE.BufferGeometry();
  q.setAttribute('position', pick(p));
  q.setAttribute('normal', pick(n));
  return q;
}
// Lumps shaped from a sphere, their normals following the shape itself, so that a coarse lump is still shaded round (not in
// facets): an icosahedron split `fineness` times, each point moved to shape(direction, out) and facing the way the shape faces
// there. The supplied rock primitive uses the same sampling rule.
const _dir = new THREE.Vector3(),
  _side = new THREE.Vector3(),
  _up = new THREE.Vector3(),
  _here = new THREE.Vector3(),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3();
function lump(fineness, shape) {
  const g = new THREE.IcosahedronGeometry(1, fineness),
    position = g.attributes.position.array,
    normal = g.attributes.normal.array,
    near = 0.03; // how far round the sphere the shape is sampled to find which way it faces
  for (let i = 0; i < position.length; i += 3) {
    _dir.set(position[i], position[i + 1], position[i + 2]).normalize();
    _side.set(-_dir.z, 0, _dir.x);
    if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0);
    _side.normalize();
    _up.crossVectors(_side, _dir);
    shape(_dir, _here);
    shape(_a.copy(_dir).addScaledVector(_side, near).normalize(), _a).sub(_here);
    shape(_b.copy(_dir).addScaledVector(_up, near).normalize(), _b).sub(_here);
    _a.cross(_b).normalize();
    if (_a.dot(_dir) < 0) _a.negate();
    position.set([_here.x, _here.y, _here.z], i);
    normal.set([_a.x, _a.y, _a.z], i);
  }
  return g;
}
// A stone broken from the rock, about a metre across and a little lower than it is wide: worn round by the weather, with three
// faces where it split along its joints, and flat where it lies; shaded round where it is worn and flat on its broken faces
// (80 triangles). Its colours are white, for the builder's colour to tint.
const STONE_JOINTS = [
  [0.62, 0.5, 0.6, 0.37],
  [-0.74, 0.18, 0.64, 0.39],
  [0.12, 0.3, -0.95, 0.4],
].map(([x, y, z, d]) => [x / Math.hypot(x, y, z), y / Math.hypot(x, y, z), z / Math.hypot(x, y, z), d]); // [the face's normal, its distance from the middle]
const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0);
/**
 * Build a library of reusable unit geometries for scenery, roofs and figures.
 * @param fbm - Fractal noise sampler used to shape the rock. Pass the world’s seeded sampler to reproduce it.
 */
export function createUnitShapes(fbm = createNoise().fbm) {
  function stonePoint(dir, out) {
    let r = 0.5 * (0.8 + 0.4 * fbm(dir.x * 1.7 + 3, dir.z * 1.7 + dir.y * 1.3, 2, 190));
    for (const [nx, ny, nz, d] of STONE_JOINTS) {
      const towards = dir.x * nx + dir.y * ny + dir.z * nz;
      if (towards > 0.05) r = Math.min(r, d / towards);
    }
    return out.set(dir.x * r, Math.max(dir.y * r * 0.82, -0.3), dir.z * r);
  }
  function brokenStone() {
    const g = lump(1, stonePoint);
    // white vertex colours: an instanced rock on a material that reads vertex colours would otherwise be drawn black
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    return g;
  }
  return {
    box,
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0),
    cyl6,
    taper: new THREE.CylinderGeometry(0.3, 0.5, 1, 6).translate(0, 0.5, 0),
    cone: new THREE.ConeGeometry(0.5, 1, 10).translate(0, 0.5, 0),
    cone6: new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0),
    pyr: new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    dome: new THREE.SphereGeometry(0.5, 10, 5, 0, TAU, 0, Math.PI / 2),
    sph: new THREE.IcosahedronGeometry(0.5, 1),
    rock: brokenStone(),
    prism: prismGeometry(),
    eaves: without(prismGeometry(), '+z', '-z'), // a gable roof's two slopes, its ends left open for its gables
    gable: gableGeometry(),
    torso: new THREE.CylinderGeometry(0.5, 0.4, 1, 12).translate(0, 0.5, 0),
    skirt: new THREE.CylinderGeometry(0.32, 0.5, 1, 12).translate(0, 0.5, 0),
    head: new THREE.IcosahedronGeometry(0.5, 2),
    limb: new THREE.CylinderGeometry(0.5, 0.38, 1, 8).translate(0, -0.5, 0),
    cloak: new THREE.CylinderGeometry(0.5, 0.64, 1, 10, 3, true, Math.PI * 0.5, Math.PI).translate(0, -0.5, 0),
    quad: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
    boxF: without(box, '-z'), // a box without its back face, for parts fixed to a wall
    boxFootless: without(box, '-y'), // a box without its foot, for parts that stand on something or go into a wall at their foot
    cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
    fing: new THREE.CylinderGeometry(0.5, 0.4, 1, 5).translate(0, -0.5, 0),
    cone16: new THREE.ConeGeometry(0.5, 1, 16).translate(0, 0.5, 0),
    dome16: new THREE.SphereGeometry(0.5, 20, 8, 0, TAU, 0, Math.PI / 2),
  };
}
function C(hex, jitter = 0, rng) {
  // sRGB hex -> linear [r,g,b], optionally brightness-jittered
  _cc.setHex(hex);
  const k = jitter && rng ? 1 + (rng() - 0.5) * 2 * jitter : 1;
  return [_cc.r * k, _cc.g * k, _cc.b * k];
}

// A rod of radius r from point a to point b ([x, y, z]), added to the builder gb.
const _rod = {
    m: new THREE.Matrix4(),
    at: new THREE.Vector3(),
    turn: new THREE.Quaternion(),
    size: new THREE.Vector3(),
    way: new THREE.Vector3(),
  },
  UP = new THREE.Vector3(0, 1, 0);
function stick(gb, a, b, r, col, geo = cyl6) {
  const { m, at, turn, size, way } = _rod;
  way.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = way.length();
  turn.setFromUnitVectors(UP, way.divideScalar(len));
  gb.add(geo, col, m.compose(at.set(a[0], a[1], a[2]), turn, size.set(r, len, r)));
}

export { box, C, TRS, lump, stick, without };

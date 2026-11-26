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
  rotationScratch = new THREE.Quaternion(),
  eulerScratch = new THREE.Euler(),
  scaleScratch = new THREE.Vector3(),
  positionScratch = new THREE.Vector3(),
  colorScratch = new THREE.Color();
function TRS(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  // returns a shared matrix: use it immediately
  eulerScratch.set(rx, ry, rz, 'YXZ');
  rotationScratch.setFromEuler(eulerScratch);
  return _m4.compose(positionScratch.set(x, y, z), rotationScratch, scaleScratch.set(sx, sy, sz));
}
// A unit triangular prism, the shape of a gable roof.
function prismGeometry() {
  const backLeft = [-0.5, 0, -0.5],
    backRight = [0.5, 0, -0.5],
    frontRight = [0.5, 0, 0.5],
    frontLeft = [-0.5, 0, 0.5],
    backRidge = [0, 1, -0.5],
    frontRidge = [0, 1, 0.5];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    backLeft, frontLeft, frontRidge,
    backLeft, frontRidge, backRidge,
    backRight, backRidge, frontRidge,
    backRight, frontRidge, frontRight,
    frontLeft, frontRight, frontRidge,
    backRight, backLeft, backRidge,
  ].flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}
// The two triangular ends of that prism alone: a gable's wall, under a roof drawn without them.
function gableGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5], 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}
// The ways a face can look, as [axis, sign]
const WAYS = { '+x': [0, 1], '-x': [0, -1], '+y': [1, 1], '-y': [1, -1], '+z': [2, 1], '-z': [2, -1] };
// A unit shape without its flat faces that look the ways named ('+x', '-y', ...), the rest in their order: for a part whose faces
// lie against something, where no one can see them (the back of a box fixed to a wall, the foot of a rod set in one)
function without(shape, ...ways) {
  const sourceGeometry = shape.index ? shape.toNonIndexed() : shape,
    positions = sourceGeometry.attributes.position.array,
    n = sourceGeometry.attributes.normal.array,
    away = t => ways.some(w => [0, 3, 6].every(k => n[t + k + WAYS[w][0]] * WAYS[w][1] > 0.99)),
    kept = [];
  for (let t = 0; t < positions.length; t += 9) if (!away(t)) kept.push(t);
  const pick = attribute => {
      const out = new Float32Array(kept.length * 9);
      kept.forEach((t, i) => out.set(attribute.subarray(t, t + 9), i * 9));
      return new THREE.BufferAttribute(out, 3);
    },
    q = new THREE.BufferGeometry();
  q.setAttribute('position', pick(positions));
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
  const geometry = new THREE.IcosahedronGeometry(1, fineness),
    position = geometry.attributes.position.array,
    normal = geometry.attributes.normal.array,
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
  return geometry;
}
// A stone broken from the rock, about a metre across and a little lower than it is wide: worn round by the weather, with three
// faces where it split along its joints, and flat where it lies; shaded round where it is worn and flat on its broken faces
// (80 triangles). Its colours are white, for the builder's colour to tint.
const STONE_JOINTS = [
  [0.62, 0.5, 0.6, 0.37],
  [-0.74, 0.18, 0.64, 0.39],
  [0.12, 0.3, -0.95, 0.4],
].map(([x, y, z, planeDistance]) => [x / Math.hypot(x, y, z), y / Math.hypot(x, y, z), z / Math.hypot(x, y, z), planeDistance]); // [the face's normal, its distance from the middle]
const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0);
/**
 * Build a library of reusable unit geometries for scenery, roofs and figures.
 * @param fbm - Fractal noise sampler used to shape the rock. Pass the world’s seeded sampler to reproduce it.
 */
export function createUnitShapes(fbm = createNoise().fbm) {
  function stonePoint(dir, out) {
    let r = 0.5 * (0.8 + 0.4 * fbm(dir.x * 1.7 + 3, dir.z * 1.7 + dir.y * 1.3, 2, 190));
    for (const [nx, ny, nz, planeDistance] of STONE_JOINTS) {
      const towards = dir.x * nx + dir.y * ny + dir.z * nz;
      if (towards > 0.05) r = Math.min(r, planeDistance / towards);
    }
    return out.set(dir.x * r, Math.max(dir.y * r * 0.82, -0.3), dir.z * r);
  }
  function brokenStone() {
    const geometry = lump(1, stonePoint);
    // white vertex colours: an instanced rock on a material that reads vertex colours would otherwise be drawn black
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
    return geometry;
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
function C(hex, jitter = 0, random) {
  // sRGB hex -> linear [r,g,b], optionally brightness-jittered
  colorScratch.setHex(hex);
  const k = jitter && random ? 1 + (random() - 0.5) * 2 * jitter : 1;
  return [colorScratch.r * k, colorScratch.g * k, colorScratch.b * k];
}

// Append a rod of the given radius between the start and end points, both [x, y, z].
const _rod = {
    m: new THREE.Matrix4(),
    at: new THREE.Vector3(),
    turn: new THREE.Quaternion(),
    size: new THREE.Vector3(),
    way: new THREE.Vector3(),
  },
  UP = new THREE.Vector3(0, 1, 0);
function stick(builder, start, end, radius, color, geometry = cyl6) {
  const { m, at, turn, size, way } = _rod;
  way.set(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const len = way.length();
  turn.setFromUnitVectors(UP, way.divideScalar(len));
  builder.add(geometry, color, m.compose(at.set(start[0], start[1], start[2]), turn, size.set(radius, len, radius)));
}

export { box, C, TRS, lump, stick, without };

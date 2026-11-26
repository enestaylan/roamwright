import { Matrix4 } from 'three';
import { TRS } from './primitives.js';

// Builders can share the stable matrix reference. Stack entries are reused on subsequent pushes.
export function createBuilderFrame() {
  const matrix = new Matrix4(), stack = [];
  let depth = 0;
  function push(local) {
    (stack[depth] ??= new Matrix4()).copy(matrix);
    depth++;
    matrix.multiply(local);
  }
  function pop() {
    if (!depth) throw new RangeError('Builder frame stack is empty');
    matrix.copy(stack[--depth]);
  }
  return { matrix, push, pop };
}

const FACE_NORMAL = [
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [-1, 0, 0],
].map(Object.freeze);
const FACE_RY = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
// Number faces +Z, -Z, +X, -X. Dimensions and offsets are in world units.
// put(builder, shape, color, along, height, outward, sx, sy, sz, roll, pitch) adds geometry.
// put.point(along, height, outward) and the read-only put.normal describe the same face.
export function boxFacePlacer(face, halfWidth, halfDepth, offsetX = 0, offsetZ = 0) {
  const ry = FACE_RY[face],
    normal = FACE_NORMAL[face],
    nx = normal[0],
    nz = normal[2],
    wallX = offsetX + nx * halfWidth,
    wallZ = offsetZ + nz * halfDepth;
  const xAt = (u, out) => wallX + nz * u + nx * out;
  const zAt = (u, out) => wallZ - nx * u + nz * out;
  const put = (gb, geo, col, u, y, out, sx, sy, sz, rz = 0, rx = 0) =>
    gb.add(geo, col, TRS(xAt(u, out), y, zAt(u, out), sx, sy, sz, ry, rx, rz));
  put.point = (u, y, out) => [xAt(u, out), y, zAt(u, out)];
  put.normal = normal;
  put.face = face;
  put.halfWidth = halfWidth;
  put.halfDepth = halfDepth;
  return put;
}

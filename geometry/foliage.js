import * as THREE from 'three';
import { indexParts } from './index-parts.js';

const _tint = [0, 0, 0],
  _n3 = new THREE.Matrix3(),
  _v = new THREE.Vector3(); // scratch values of this module

// An empty set of parts: positions, normals, colours and leaf flags.
function shapeParts() {
  return { p: [], n: [], c: [], l: [] };
}
// Adds a geometry to parts, placed by the transform matrix, each vertex coloured by tint(x, y, z, out) in its own space; leaf 1 for foliage.
function addShape(parts, geometry, transform, tint, leaf) {
  const sourceGeometry = geometry.index ? geometry.toNonIndexed() : geometry,
    positions = sourceGeometry.attributes.position.array,
    normals = sourceGeometry.attributes.normal.array;
  _n3.getNormalMatrix(transform);
  for (let i = 0; i < positions.length; i += 3) {
    tint(positions[i], positions[i + 1], positions[i + 2], _tint);
    _v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(transform);
    parts.p.push(_v.x, _v.y, _v.z);
    _v.set(normals[i], normals[i + 1], normals[i + 2])
      .applyMatrix3(_n3)
      .normalize();
    parts.n.push(_v.x, _v.y, _v.z);
    parts.c.push(_tint[0], _tint[1], _tint[2]);
    parts.l.push(leaf);
  }
}
// A static plant model can be instanced many times with one immutable index buffer.
function partsGeometry(parts) {
  const attributes = indexParts({
    position: new Float32Array(parts.p),
    normal: new Float32Array(parts.n),
    color: new Float32Array(parts.c),
    aLeaf: new Float32Array(parts.l),
  });
  const geometry = new THREE.BufferGeometry();
  for (const [name, data] of Object.entries(attributes)) {
    if (name === 'index') geometry.setIndex(new THREE.BufferAttribute(data, 1));
    else geometry.setAttribute(name, new THREE.BufferAttribute(data, name === 'aLeaf' ? 1 : 3));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export { addShape, partsGeometry, shapeParts };

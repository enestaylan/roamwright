import * as THREE from 'three';
import { indexParts } from './index-parts.js';

const _tint = [0, 0, 0],
  _n3 = new THREE.Matrix3(),
  _v = new THREE.Vector3(); // scratch values of this module

// An empty set of parts: positions, normals, colours and leaf flags.
function shapeParts() {
  return { p: [], n: [], c: [], l: [] };
}
// Adds a geometry to parts, placed by matrix m, each vertex coloured by tint(x, y, z, out) in its own space; leaf 1 for foliage.
function addShape(parts, geo, m, tint, leaf) {
  const g = geo.index ? geo.toNonIndexed() : geo,
    pa = g.attributes.position.array,
    na = g.attributes.normal.array;
  _n3.getNormalMatrix(m);
  for (let i = 0; i < pa.length; i += 3) {
    tint(pa[i], pa[i + 1], pa[i + 2], _tint);
    _v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(m);
    parts.p.push(_v.x, _v.y, _v.z);
    _v.set(na[i], na[i + 1], na[i + 2])
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

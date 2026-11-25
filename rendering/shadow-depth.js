import * as THREE from 'three';
import {isStill, keptAway, placeOf, still, STILL_LAYER} from './still-casters.js';

const handlers = new WeakMap();
let installed = 0;
let previousBefore, previousAfter;

// Delegating to previous hooks also preserves application hooks installed before this extension.
function before(renderer, object, camera, shadowCamera, geometry, material, group) {
  previousBefore.call(this, renderer, object, camera, shadowCamera, geometry, material, group);
  handlers.get(renderer)?.begin(this, shadowCamera, geometry, material);
}
function after(renderer, object, camera, shadowCamera, geometry, material, group) {
  handlers.get(renderer)?.end(this, geometry);
  previousAfter.call(this, renderer, object, camera, shadowCamera, geometry, material, group);
}

function kindOf(o) {
  const morph = o.geometry.morphAttributes;
  if (morph.position || morph.normal || morph.color) return null;
  if (o.isSkinnedMesh) return 'skinned';
  if (o.isInstancedMesh) return o.instanceColor ? 'tinted' : 'instanced';
  return null;
}

// Opt in one renderer. Meshes with their own shadow hooks continue to use them.
export function installShadowDepth(renderer) {
  if (handlers.has(renderer)) throw new Error('Shadow depth hooks already installed for this renderer');
  const materials = {customDepthMaterial: {}, customDistanceMaterial: {}}, entries = new WeakMap();
  const world = new THREE.Matrix4(), instance = new THREE.Matrix4(), sphere = new THREE.Sphere();
  function noneNear(object, at, reach, entry) {
    const matrix = object.instanceMatrix;
    const geometry = object.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const bounds = geometry.boundingSphere;
    if (entry.matrix === matrix && entry.version === matrix.version && entry.count === object.count &&
        entry.reach === reach && entry.x === at.x && entry.y === at.y && entry.z === at.z &&
        entry.bounds.equals(bounds) && entry.world.equals(object.matrixWorld)) return entry.away;
    entry.matrix = matrix;
    entry.version = matrix.version;
    entry.count = object.count;
    entry.reach = reach;
    entry.x = at.x; entry.y = at.y; entry.z = at.z;
    (entry.world ??= new THREE.Matrix4()).copy(object.matrixWorld);
    (entry.bounds ??= new THREE.Sphere()).copy(bounds);
    entry.away = true;
    for (let i = 0; i < object.count; ++i) {
      object.getMatrixAt(i, instance);
      world.multiplyMatrices(object.matrixWorld, instance);
      sphere.copy(bounds).applyMatrix4(world);
      if (sphere.center.distanceToSquared(at) <= (reach + sphere.radius) ** 2) {
        entry.away = false;
        break;
      }
    }
    return entry.away;
  }
  function begin(object, shadowCamera, geometry, material) {
    const point = material.isMeshDistanceMaterial;
    let entry = entries.get(object);
    if (point && isStill(object)) {
      const at = placeOf(object.matrixWorld.elements);
      if (still.kept && object.keptIn === still.round && object.keptAs !== at) object.layers.disable(STILL_LAYER);
      if (keptAway(object, at)) {
        if (!entry) entries.set(object, entry = {});
        entry.range = geometry.drawRange.count;
        geometry.drawRange.count = -1;
      }
      return;
    }
    if (!(object.isInstancedMesh || object.isSkinnedMesh)) return;
    if (!entry) entries.set(object, entry = {});
    if (object.isInstancedMesh && point && noneNear(object, shadowCamera.position, shadowCamera.far, entry)) {
      entry.countAside = object.count;
      object.count = 0;
    }
    const field = point ? 'customDistanceMaterial' : 'customDepthMaterial';
    if (object[field] !== undefined && object[field] !== entry[field]) return;
    const skin = object.material;
    const kind = kindOf(object);
    if (!kind || Array.isArray(skin) || skin.alphaTest > 0 || skin.alphaToCoverage || skin.displacementMap || skin.clippingPlanes?.length) {
      if (entry[field] && object[field] === entry[field]) object[field] = undefined;
      return;
    }
    let shared = materials[field][kind];
    if (!shared) {
      shared = point ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial(
        Number(THREE.REVISION) <= 170 ? {depthPacking: THREE.RGBADepthPacking} : {}
      );
      materials[field][kind] = shared;
    }
    object[field] = entry[field] = shared;
  }
  function end(object, geometry) {
    const entry = entries.get(object);
    if (!entry) return;
    if (entry.range !== undefined) {
      geometry.drawRange.count = entry.range;
      entry.range = undefined;
    }
    if (entry.countAside !== undefined) {
      object.count = entry.countAside;
      entry.countAside = undefined;
    }
  }
  if (installed++ === 0) {
    previousBefore = THREE.Object3D.prototype.onBeforeShadow;
    previousAfter = THREE.Object3D.prototype.onAfterShadow;
    THREE.Object3D.prototype.onBeforeShadow = before;
    THREE.Object3D.prototype.onAfterShadow = after;
  }
  handlers.set(renderer, {begin, end});
  function dispose(root) {
    if (!handlers.delete(renderer)) return;
    root?.traverse(o => {
      const entry = entries.get(o);
      if (!entry) return;
      for (const field of ['customDepthMaterial','customDistanceMaterial']) {
        if (entry[field] && o[field] === entry[field]) o[field] = undefined;
      }
    });
    for (const group of Object.values(materials)) for (const material of Object.values(group)) material.dispose();
    if (--installed === 0) {
      if (THREE.Object3D.prototype.onBeforeShadow === before) THREE.Object3D.prototype.onBeforeShadow = previousBefore;
      if (THREE.Object3D.prototype.onAfterShadow === after) THREE.Object3D.prototype.onAfterShadow = previousAfter;
    }
  }
  return {dispose};
}

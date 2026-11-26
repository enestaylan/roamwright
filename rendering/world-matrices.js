import * as THREE from 'three';


// ════════════════════════════════════════════════════════════════════════
//  Where everything stands in the world, worked out once a frame and only for what moved
// ════════════════════════════════════════════════════════════════════════
// Update world transforms once before rendering multiple passes. Compose a local
// matrix when its transform changes, then propagate changes through descendants.
// Reparenting also invalidates the world transform. For manually managed matrices,
// set matrixWorldNeedsUpdate after editing the matrix directly.


const plainWalk = THREE.Object3D.prototype.updateMatrixWorld;

// Has the object been moved, turned or scaled since it was last asked? (The first time it has.)
function moved(object) {
  const position = object.position,
    rotation = object.quaternion,
    scale = object.scale;
  let lastTransform = object.placedAt;
  if (lastTransform === undefined) lastTransform = object.placedAt = new Float64Array(10).fill(NaN);
  if (
    lastTransform[0] === position.x &&
    lastTransform[1] === position.y &&
    lastTransform[2] === position.z &&
    lastTransform[3] === rotation.x &&
    lastTransform[4] === rotation.y &&
    lastTransform[5] === rotation.z &&
    lastTransform[6] === rotation.w &&
    lastTransform[7] === scale.x &&
    lastTransform[8] === scale.y &&
    lastTransform[9] === scale.z
  )
    return false;
  lastTransform[0] = position.x;
  lastTransform[1] = position.y;
  lastTransform[2] = position.z;
  lastTransform[3] = rotation.x;
  lastTransform[4] = rotation.y;
  lastTransform[5] = rotation.z;
  lastTransform[6] = rotation.w;
  lastTransform[7] = scale.x;
  lastTransform[8] = scale.y;
  lastTransform[9] = scale.z;
  return true;
}
// Three's own walk (Object3D.updateMatrixWorld), but for the test of what moved
function place(object, force) {
  if (object.updateMatrixWorld !== plainWalk) {
    object.updateMatrixWorld(force); // a kind with work of its own to do (a camera, a skinned mesh): Three's walk from here down
    return;
  }
  if (object.matrixAutoUpdate && moved(object)) object.updateMatrix();
  if (object.placedUnder !== object.parent) {
    object.placedUnder = object.parent;
    force = true;
  }
  if (object.matrixWorldNeedsUpdate || force) {
    if (object.matrixWorldAutoUpdate) {
      if (object.parent === null) object.matrixWorld.copy(object.matrix);
      else object.matrixWorld.multiplyMatrices(object.parent.matrixWorld, object.matrix);
    }
    object.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = object.children;
  for (let i = 0; i < children.length; i++) place(children[i], force);
}
// Called once a frame, before anything is drawn
function trackWorldMatrices(scene) {
  scene.matrixWorldAutoUpdate = false;
  return () => place(scene, false);
}

export { trackWorldMatrices };

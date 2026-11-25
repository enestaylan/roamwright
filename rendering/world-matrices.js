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
function moved(o) {
  const p = o.position,
    q = o.quaternion,
    s = o.scale;
  let k = o.placedAt;
  if (k === undefined) k = o.placedAt = new Float64Array(10).fill(NaN);
  if (
    k[0] === p.x &&
    k[1] === p.y &&
    k[2] === p.z &&
    k[3] === q.x &&
    k[4] === q.y &&
    k[5] === q.z &&
    k[6] === q.w &&
    k[7] === s.x &&
    k[8] === s.y &&
    k[9] === s.z
  )
    return false;
  k[0] = p.x;
  k[1] = p.y;
  k[2] = p.z;
  k[3] = q.x;
  k[4] = q.y;
  k[5] = q.z;
  k[6] = q.w;
  k[7] = s.x;
  k[8] = s.y;
  k[9] = s.z;
  return true;
}
// Three's own walk (Object3D.updateMatrixWorld), but for the test of what moved
function place(o, force) {
  if (o.updateMatrixWorld !== plainWalk) {
    o.updateMatrixWorld(force); // a kind with work of its own to do (a camera, a skinned mesh): Three's walk from here down
    return;
  }
  if (o.matrixAutoUpdate && moved(o)) o.updateMatrix();
  if (o.placedUnder !== o.parent) {
    o.placedUnder = o.parent;
    force = true;
  }
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = o.children;
  for (let i = 0; i < children.length; i++) place(children[i], force);
}
// Called once a frame, before anything is drawn
function trackWorldMatrices(scene) {
  scene.matrixWorldAutoUpdate = false;
  return () => place(scene, false);
}

export { trackWorldMatrices };

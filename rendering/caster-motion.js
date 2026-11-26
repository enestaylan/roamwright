// Coarse movement signatures for point-light shadow refresh. A skinned caster in range
// returns -1. Instances contribute their nearby transforms and reuse cached sums.
export function createCasterMotion({ scene, elapsed, listInterval = 2, skinnedRadius = 2 }) {
  let listedAt = -Infinity;
  const skinned = [],
    instanced = [];

  function list(now) {
    listedAt = now;
    skinned.length = instanced.length = 0;
    scene.traverseVisible(o => {
      if (!o.castShadow) return;
      if (o.isSkinnedMesh) skinned.push(o);
      else if (o.isInstancedMesh) instanced.push(o);
    });
  }

  // A sum of where every instance within reach of (x, y, z) stands and how it is turned, or -1 when a figure stands there. A mesh
  // whose instances and own place are as they were keeps the share it had (most never change: a market's stalls, a grove).
  let atX = NaN,
    atY = NaN,
    atZ = NaN,
    lastReach = NaN;
  const cached = new WeakMap();
  function stirsOf(x, y, z, reach) {
    const now = elapsed();
    if (now - listedAt > listInterval) list(now);
    for (let i = 0; i < skinned.length; i++) {
      const o = skinned[i],
        e = o.matrixWorld.elements,
        r = reach + skinnedRadius;
      if (o.visible && (e[12] - x) ** 2 + (e[13] - y) ** 2 + (e[14] - z) ** 2 < r * r) return -1;
    }
    const moved = x !== atX || y !== atY || z !== atZ || reach !== lastReach;
    atX = x;
    atY = y;
    atZ = z;
    lastReach = reach;
    let sum = 0;
    for (let i = 0; i < instanced.length; i++) {
      const o = instanced[i];
      if (!o.visible || !o.count) continue;
      let sample = cached.get(o);
      if (!sample) {
        sample = { matrix: o.matrixWorld.clone(), version: -1, count: 0, sum: 0 };
        cached.set(o, sample);
      }
      const version = o.instanceMatrix.version;
      if (moved || sample.version !== version || sample.count !== o.count || !sample.matrix.equals(o.matrixWorld)) {
        sample.version = version;
        sample.count = o.count;
        sample.matrix.copy(o.matrixWorld);
        sample.sum = shareOf(o, o.matrixWorld.elements, x, y, z, reach);
      }
      sum += sample.sum * (i + 1);
    }
    return sum;
  }
  // One mesh's share: its instances within reach, each by its place in the world (by the mesh's own matrix, mostly none) and turn.
  function shareOf(o, w, x, y, z, reach) {
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const instanceMatrices = o.instanceMatrix.array,
      r = reach + o.geometry.boundingSphere.radius;
    let sum = 0;
    for (let k = 0; k < o.count; k++) {
      const j = k * 16,
        px = instanceMatrices[j + 12],
        py = instanceMatrices[j + 13],
        pz = instanceMatrices[j + 14],
        wx = w[0] * px + w[4] * py + w[8] * pz + w[12],
        wy = w[1] * px + w[5] * py + w[9] * pz + w[13],
        wz = w[2] * px + w[6] * py + w[10] * pz + w[14];
      if ((wx - x) ** 2 + (wy - y) ** 2 + (wz - z) ** 2 < r * r) sum += (k + 1) * (wx + 3 * wy + 7 * wz + instanceMatrices[j] + 5 * instanceMatrices[j + 2]);
    }
    return sum;
  }

  return stirsOf;
}

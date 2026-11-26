// Detach owned roots and release their geometry and instance buffers. Materials are
// borrowed. A shared shape can outlive its instances by listing it in sharedGeometries.
export function disposeMeshRoots(roots, sharedGeometries) {
  const released = new Set();
  function release(mesh) {
    const geometry = mesh.geometry;
    if (mesh.isInstancedMesh) mesh.dispose();
    if (!geometry || released.has(geometry) || sharedGeometries?.has(geometry)) return;
    released.add(geometry);
    if (mesh.isPieceBatch) mesh.free();
    else geometry.dispose();
  }
  for (let childIndex = roots.length - 1; childIndex >= 0; childIndex--) {
    const root = roots[childIndex];
    root.removeFromParent();
    root.traverse(release);
  }
}

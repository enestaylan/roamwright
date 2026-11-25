import * as THREE from 'three';

// Read the highest opaque surface in a square viewed from above. The chosen
// layer is temporarily reserved during the offscreen draw. Queries may overlap.
export function createHeightProbe(renderer, scene, { layer, size, above, below, beforeRead } = {}) {
  const sampleSize = size ?? 32, ceiling = above ?? 100, floor = below ?? 10;
  const view = new THREE.OrthographicCamera();
  view.layers.set(layer ?? 3);
  view.up.set(0, 0, -1);
  const mask = view.layers.mask;
  let target, depthMaterial;
  const clear = new THREE.Color();
  const prevLayers = [];
  function solidMesh(object) {
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    return object.isMesh && object.onBeforeRender === THREE.Object3D.prototype.onBeforeRender &&
      material && !material.transparent && material.depthWrite !== false && material.visible !== false;
  }
  function select(object) {
    const solid = object.isLight || solidMesh(object);
    const before = object.layers.mask;
    const after = solid ? before | mask : before & ~mask;
    if (after !== before) {
      prevLayers.push(object, before);
      object.layers.mask = after;
    }
  }

  function depth() {
    return depthMaterial ??= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  }

  // Prepare the same depth override as a measurement. The probe includes every visible light
  // on its reserved layer, and preserves scene fog when rendering the override.
  function warm(root, warmStandIns) {
    const previous = view.layers.mask;
    view.layers.enableAll();
    try { return warmStandIns(root, o => solidMesh(o) && depth(), view, undefined, scene.fog, true); }
    finally { view.layers.mask = previous; }
  }

  async function measure(x, y, z, half) {
    if (beforeRead) await beforeRead();
    target ??= new THREE.WebGLRenderTarget(sampleSize, sampleSize, { depthBuffer: true });
    Object.assign(view, { left:-half, right:half, top:half, bottom:-half, near:0, far:ceiling+floor });
    view.updateProjectionMatrix();
    view.position.set(x,y+ceiling,z);
    view.lookAt(x,y,z);
    view.updateMatrixWorld();
    const originalTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const alpha = renderer.getClearAlpha(), background = scene.background, override = scene.overrideMaterial;
    const { autoUpdate, needsUpdate } = renderer.shadowMap;
    renderer.getClearColor(clear);
    const pixels = new Uint8Array(sampleSize * sampleSize * 4);
    let read;
    try {
      scene.traverse(select);
      scene.overrideMaterial = depth();
      scene.background = null;
      renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(scene, view);
      read = renderer.readRenderTargetPixelsAsync(target,0,0,sampleSize,sampleSize,pixels);
    } finally {
      renderer.setRenderTarget(originalTarget, face, mip);
      renderer.setClearColor(clear, alpha);
      scene.overrideMaterial = override;
      scene.background = background;
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.shadowMap.needsUpdate = needsUpdate;
      for (let i=0;i<prevLayers.length;i+=2) prevLayers[i].layers.mask = prevLayers[i+1];
      prevLayers.length = 0;
    }
    await read;
    let nearest = 1;
    for (let i=0;i<pixels.length;i+=4) {
      const depth = (pixels[i] + pixels[i+1]/256 + pixels[i+2]/65536) / 256;
      nearest = Math.min(nearest, depth);
    }
    return nearest >= 0.999 ? y : Math.max(y, y + ceiling - nearest * (ceiling+floor));
  }

  function dispose() {
    target?.dispose();
    depthMaterial?.dispose();
    target = depthMaterial = null;
  }
  return { measure, warm, dispose };
}

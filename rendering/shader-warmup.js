import * as THREE from 'three';

// WebGLPrograms also selects variants by object and geometry, independently of material identity.
function meshKind(object) {
  const { morphAttributes: morph = {}, attributes = {} } = object.geometry ?? {};
  let key = '';
  if (object.isSkinnedMesh) key += ':skin';
  if (object.isInstancedMesh) {
    key += ':instances';
    if (object.instanceColor) key += ':instanceColor';
    if (object.morphTexture) key += ':instanceMorph';
  }
  if (object.isBatchedMesh) key += object._colorsTexture ? ':batchColor' : ':batch';
  if (object.isPoints) key += attributes.uv ? ':pointUV' : ':points';
  if (object.isLine) key += ':line';
  if (object.isSprite) key += object.center ? ':spriteCenter' : ':sprite';
  if (morph.position?.length || morph.normal?.length || morph.color?.length) {
    key += ':morph:' + (morph.position?.length ?? 0) + ':' + (morph.normal?.length ?? 0) + ':' + (morph.color?.length ?? 0);
  }
  if (attributes.uv1) key += ':uv1';
  if (attributes.uv2) key += ':uv2';
  if (attributes.uv3) key += ':uv3';
  if (attributes.tangent) key += ':tangent';
  if (attributes.color?.itemSize === 4) key += ':rgba';
  return key;
}

function representatives(root) {
  const picked = new Map();
  root.traverse(object => {
    if (!(object.isMesh || object.isPoints || object.isLine || object.isSprite) || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material.map(m => m.uuid).join(',') : object.material.uuid;
    const key = materials + ':' + meshKind(object);
    if (!picked.has(key)) picked.set(key, object);
  });
  return [...picked.values()];
}

const shadowSide = [THREE.BackSide, THREE.FrontSide, THREE.DoubleSide];

// Compile a group in its lighting environment, including material overrides and offscreen passes.
// All scratch resources and readiness polling belong to this renderer instance.
export function createShaderWarmup({renderer, scene, camera, postMaterials = () => [], pollIntervalMs = 10}) {
  const target = new THREE.WebGLRenderTarget(1, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), []);
  const twins = new Map();
  const pending = new Set();
  const ready = new WeakSet();
  let timer;

  function poll() {
    const live = new Set(renderer.info.programs);
    for (const entry of pending) {
      for (const program of entry.programs) {
        if (!live.has(program)) entry.programs.delete(program);
        else if (ready.has(program) || program.isReady()) {
          ready.add(program);
          entry.programs.delete(program);
        }
      }
      if (entry.programs.size) continue;
      pending.delete(entry);
      entry.resolve();
    }
    timer = pending.size ? setTimeout(poll, pollIntervalMs) : undefined;
  }

  function begin(traverse, root, view, lit, yieldIfReady = false) {
    const materials = renderer.compile({
      traverse,
      traverseVisible: visit => { if (lit !== root) root.traverseVisible(visit); }
    }, view, lit);
    const programs = new Set();
    for (const m of materials) {
      const variants = renderer.properties.get(m).programs;
      if (variants) for (const program of variants.values()) {
        if (!ready.has(program)) programs.add(program);
      }
    }
    if (!programs.size && !yieldIfReady) return Promise.resolve();
    return new Promise(resolve => {
      pending.add({programs, resolve});
      if (timer === undefined) timer = setTimeout(poll, 0);
    });
  }

  function withTarget(into, work) {
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(into);
    try { return work(); }
    finally { renderer.setRenderTarget(previous, face, level); }
  }

  function compiled(root, view = camera, lit = root) {
    const objects = representatives(root);
    return begin(visit => objects.forEach(visit), root, view, lit);
  }

  async function compiledInTurn(root, view = camera, lit = scene, into = null) {
    for (const object of representatives(root)) {
      await withTarget(into, () => begin(visit => visit(object), root, view, lit, true));
    }
  }

  function warmStandIns(root, standIn, view, into, fog) {
    const picked = new Map();
    root.traverse(object => {
      if (!(object.isMesh || object.isPoints || object.isLine) || !object.material || Array.isArray(object.material)) return;
      const m = standIn(object);
      if (!m) return;
      const key = [m.uuid, m.side, !!m.map, !!m.alphaMap, m.alphaTest > 0, meshKind(object)].join(':');
      if (!picked.has(key)) picked.set(key, object);
    });
    return withTarget(into, () => {
      const previousFog = scene.fog;
      scene.fog = fog;
      try {
        // Three gathers the target scene's lights once per compile. Submit the entire override pass
        // together, applying mutable stand-ins only while Three prepares their representative.
        return begin(visit => {
          for (const object of picked.values()) {
            const material = object.material;
            try {
              object.material = standIn(object);
              visit(object);
            } finally { object.material = material; }
          }
        }, scene, view, scene);
      } finally { scene.fog = previousFog; }
    });
  }

  function shadowMaterial(object, point) {
    const material = object.material;
    const side = material.shadowSide ?? (renderer.shadowMap.type === THREE.VSMShadowMap ? material.side : shadowSide[material.side]);
    const key = [point, side, !!material.map, !!material.alphaMap, material.alphaTest > 0].join(':');
    let twin = point ? object.customDistanceMaterial : object.customDepthMaterial;
    if (!twin) {
      twin = twins.get(key);
      if (!twin) {
        twin = point ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial(
          Number(THREE.REVISION) <= 170 ? {depthPacking: THREE.RGBADepthPacking} : {}
        );
        twins.set(key, twin);
      }
    }
    twin.side = side;
    twin.map = material.map;
    twin.alphaMap = material.alphaMap;
    twin.alphaTest = material.alphaToCoverage ? 0.5 : material.alphaTest;
    twin.displacementMap = material.displacementMap;
    twin.clippingPlanes = material.clippingPlanes;
    twin.clipIntersection = material.clipIntersection;
    twin.clipShadows = material.clipShadows;
    return twin;
  }

  function warmShadowPass(root, {waitForPoint = true} = {}) {
    if (!renderer.shadowMap.enabled) return Promise.resolve();
    const depth = warmStandIns(root, o => o.castShadow && shadowMaterial(o, false), camera, target, null);
    let point;
    scene.traverseVisible(o => { if (o.isPointLight && o.castShadow) point = true; });
    const distance = point && warmStandIns(root, o => o.castShadow && shadowMaterial(o, true), camera, target, null);
    for (const twin of twins.values()) {
      twin.map = twin.alphaMap = twin.displacementMap = twin.clippingPlanes = null;
    }
    return waitForPoint ? Promise.all([depth, distance]) : depth;
  }

  function warmPostPasses() {
    const screen = [], offscreen = [];
    for (const [material, into] of postMaterials()) (into === null ? screen : offscreen).push(material);
    // Three prepares each material in a material array against the same render target.
    const compilePass = (materials, into) => {
      if (!materials.length) return;
      quad.material = materials;
      return withTarget(into, () => compiled(quad, camera));
    };
    try { return Promise.all([compilePass(offscreen, target), compilePass(screen, null)]); }
    finally { quad.material = []; }
  }

  function dispose() {
    clearTimeout(timer);
    timer = undefined;
    for (const entry of pending) entry.resolve();
    pending.clear();
    quad.geometry.dispose();
    target.dispose();
    for (const twin of twins.values()) twin.dispose();
    twins.clear();
  }
  return {compiled, compiledInTurn, compilingNow: () => pending.size > 0, warmStandIns, warmShadowPass, warmPostPasses, dispose};
}

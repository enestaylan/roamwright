import * as THREE from 'three';

// Read the highest opaque surface in a square viewed from above. The chosen
// layer is temporarily reserved during the offscreen draw. Queries may overlap.
export function createHeightProbe(renderer, scene, { layer, size, above, below, beforeRead, queryResult = false } = {}) {
  const sampleSize = size ?? 32,
    ceiling = above ?? 100,
    floor = below ?? 10;
  // Limit the reduction shader to small measurement tiles; large user targets use the pixel path.
  const useQueries = queryResult && Number.isInteger(sampleSize) && sampleSize > 0 && sampleSize <= 32;
  let result;
  const depthResult = () => (result ??= createDepthResult(renderer, sampleSize));
  const view = new THREE.OrthographicCamera();
  view.layers.set(layer ?? 3);
  view.up.set(0, 0, -1);
  const mask = view.layers.mask;
  let target, depthMaterial;
  const clear = new THREE.Color();
  const prevLayers = [];
  function solidMesh(object) {
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    return (
      object.isMesh &&
      object.onBeforeRender === THREE.Object3D.prototype.onBeforeRender &&
      material &&
      !material.transparent &&
      material.depthWrite !== false &&
      material.visible !== false
    );
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
    return (depthMaterial ??= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  }

  // Prepare the same depth override as a measurement. The probe includes every visible light
  // on its reserved layer, and preserves scene fog when rendering the override.
  function warm(root, warmStandIns) {
    const previous = view.layers.mask;
    view.layers.enableAll();
    try {
      const geometry = warmStandIns(root, o => solidMesh(o) && depth(), view, undefined, scene.fog, true);
      return useQueries ? Promise.all([geometry, depthResult().warm()]) : geometry;
    } finally {
      view.layers.mask = previous;
    }
  }

  async function measure(x, y, z, half) {
    if (beforeRead) await beforeRead();
    target ??= new THREE.WebGLRenderTarget(sampleSize, sampleSize, { depthBuffer: true });
    Object.assign(view, { left: -half, right: half, top: half, bottom: -half, near: 0, far: ceiling + floor });
    view.updateProjectionMatrix();
    view.position.set(x, y + ceiling, z);
    view.lookAt(x, y, z);
    view.updateMatrixWorld();
    const originalTarget = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    const alpha = renderer.getClearAlpha(),
      background = scene.background,
      override = scene.overrideMaterial;
    const { autoUpdate, needsUpdate } = renderer.shadowMap;
    renderer.getClearColor(clear);
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
      read = useQueries ? depthResult().read(target.texture) : readMinimum();
    } finally {
      renderer.setRenderTarget(originalTarget, face, mip);
      renderer.setClearColor(clear, alpha);
      scene.overrideMaterial = override;
      scene.background = background;
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.shadowMap.needsUpdate = needsUpdate;
      for (let i = 0; i < prevLayers.length; i += 2) prevLayers[i].layers.mask = prevLayers[i + 1];
      prevLayers.length = 0;
    }
    const nearest = await read;
    return nearest >= 0.999 ? y : Math.max(y, y + ceiling - nearest * (ceiling + floor));
  }

  async function readMinimum() {
    const pixels = new Uint8Array(sampleSize * sampleSize * 4);
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, sampleSize, sampleSize, pixels);
    let nearest = 1;
    for (let i = 0; i < pixels.length; i += 4) {
      const depth = (pixels[i] + pixels[i + 1] / 256 + pixels[i + 2] / 65536) / 256;
      nearest = Math.min(nearest, depth);
    }
    return nearest;
  }

  function dispose() {
    result?.dispose();
    result = null;
    target?.dispose();
    depthMaterial?.dispose();
    target = depthMaterial = null;
  }
  return { measure, warm, dispose };
}

// Read one packed minimum without copying a GPU buffer to the page. Each exact occlusion
// query answers one bit. Queries from an earlier measurement own their results even if
// the source target is rendered again before the browser reports completion.
function createDepthResult(renderer, size) {
  const gl = renderer.getContext();
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const reduced = target.clone();
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { source: { value: null }, mask: { value: 0 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `
      uniform sampler2D source;
      uniform int mask;
      out vec4 result;
      int packedAt(ivec2 at) {
        ivec3 p = ivec3(round(texelFetch(source, at, 0).rgb * 255.));
        return (p.r << 16) | (p.g << 8) | p.b;
      }
      void main() {
        if (mask == 0) {
          int nearest = 16777215;
          for (int y = 0; y < ${size}; ++y) for (int x = 0; x < ${size}; ++x)
            nearest = min(nearest, packedAt(ivec2(x, y)));
          result = vec4(vec3(ivec3(nearest >> 16, (nearest >> 8) & 255, nearest & 255)) / 255., 1.);
          return;
        }
        if ((packedAt(ivec2(0)) & mask) == 0) discard;
        result = vec4(1.);
      }`,
  });
  const scene = new THREE.Scene(),
    camera = new THREE.Camera();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  let disposed = false,
    preparation;
  function warm() {
    if (preparation) return preparation;
    const previous = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(target);
      return (preparation = renderer.compileAsync(scene, camera));
    } finally {
      renderer.setRenderTarget(previous, face, mip);
    }
  }
  async function read(texture) {
    const queries = [];
    try {
      // Caller restores the previous render target. Never leave a query open on failure.
      const clears = renderer.autoClear;
      try {
        renderer.autoClear = false;
        renderer.setRenderTarget(reduced);
        material.uniforms.source.value = texture;
        material.uniforms.mask.value = 0;
        renderer.render(scene, camera);
        renderer.setRenderTarget(target);
        material.uniforms.source.value = reduced.texture;
        for (let bit = 0; bit < 24; bit++) {
          const query = gl.createQuery();
          if (!query) throw new Error('Could not allocate a depth query');
          queries.push(query);
          material.uniforms.mask.value = 1 << bit;
          gl.beginQuery(gl.ANY_SAMPLES_PASSED, query);
          try {
            renderer.render(scene, camera);
          } finally {
            gl.endQuery(gl.ANY_SAMPLES_PASSED);
          }
        }
      } finally {
        renderer.autoClear = clears;
      }
      gl.flush();
      do {
        await new Promise(resolve => setTimeout(resolve, 8));
        if (disposed || gl.isContextLost()) throw new Error('Depth measurement interrupted');
      } while (!queries.every(query => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)));
      let packed = 0;
      for (let bit = 0; bit < queries.length; bit++) if (gl.getQueryParameter(queries[bit], gl.QUERY_RESULT)) packed |= 1 << bit;
      return packed / 16777216;
    } finally {
      queries.forEach(query => gl.deleteQuery(query));
    }
  }
  function dispose() {
    disposed = true;
    quad.geometry.dispose();
    material.dispose();
    target.dispose();
    reduced.dispose();
  }
  return { warm, read, dispose };
}

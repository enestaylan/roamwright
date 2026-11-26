import * as THREE from 'three';

// Shared uniforms and shader hook for standard materials sampling a local sky visibility map.
export function createSkyOcclusionShader({minimum, underCover}) {
  const uniforms = {
    uSkyOpen: { value: null },
    uSkyR: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSkyOn: { value: 0 },
  };

  const SKY_OPEN = /* glsl */ `
    uniform sampler2D uSkyOpen; uniform vec4 uSkyR; uniform float uSkyOn;
    float skyOpen(vec3 viewNormal) {
      if (uSkyOn <= 0.0) return 1.0;
      vec3 wp = cameraPosition - vViewPosition * mat3(viewMatrix), wn = viewNormal * mat3(viewMatrix);
      vec2 uv = (wp.xz + wn.xz * 0.6 - uSkyR.xy) * vec2(uSkyR.z, -uSkyR.z), off = abs(uv - 0.5);
      float reach = 1.0 - smoothstep(0.36, 0.48, max(off.x, off.y));
      if (reach <= 0.0) return 1.0;
      vec4 s = texture2D(uSkyOpen, uv);
      float up = wp.y - uSkyR.w - s.g;
      float open = up < -0.6 ? ${underCover.toFixed(2)} : mix(s.r, 1.0, clamp(up / max(s.b - s.g, 0.5), 0.0, 1.0));
      return mix(1.0, ${minimum.toFixed(2)} + ${(1 - minimum).toFixed(2)} * open, uSkyOn * reach);
    }
  `;
  function patch(shader, more = '') {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SKY_OPEN)
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>\n#if defined( RE_IndirectDiffuse )\n  ${more}\n  irradiance *= skyOpen(geometryNormal);\n#endif`,
      );
  }
  return {uniforms, patch};
}

// Two passes: record overhead caster height, then integrate the horizon in eight directions.
// The first map is available immediately. Subsequent height and horizon passes alternate frames.
export function createSkyOcclusion({renderer, scene, camera, uniforms, config, samples, ground, strength,
  occludes = object => object.isMesh && object.castShadow, warmup}) {
  const {compiled, warmStandIns, compilingNow} = warmup;
  const heights = new THREE.WebGLRenderTarget(config.size, config.size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const openness = new THREE.WebGLRenderTarget(config.size, config.size, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  uniforms.uSkyOpen.value = openness.texture;
  const above = new THREE.OrthographicCamera(-config.half, config.half, config.half, -config.half, 1, config.depth);
  above.rotation.set(-Math.PI / 2, 0, 0);
  const depthOf = {
    plain: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }),
    instanced: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }),
    tinted: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }),
  };

  const openPass = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tHeights: { value: heights.texture }, uTexel: { value: (2 * config.half) / config.size } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tHeights; uniform float uTexel; varying vec2 vUv;
        float heightAt(vec2 uv) { return ${config.above.toFixed(1)} - mix(1.0, ${config.depth.toFixed(1)}, unpackRGBAToDepth(texture2D(tHeights, uv))); }
        void main() {
          float h0 = heightAt(vUv), sky = 0.0, tops = 0.0;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982;
            vec2 dir = vec2(cos(a), sin(a)) / (uTexel * ${config.size.toFixed(1)});
            float rise = 0.0, top = h0;
            ${samples.map(sampleDistance => `{ float h = heightAt(vUv + dir * ${sampleDistance.toFixed(2)}); rise = max(rise, (h - h0) / ${sampleDistance.toFixed(2)}); top = max(top, h); }`).join('\n          ')}
            sky += 1.0 / (1.0 + rise * rise);
            tops += top;
          }
          gl_FragColor = vec4(sky / 8.0, h0, tops / 8.0, 1.0);
        }`,
    }),
  );
  openPass.frustumCulled = false;
  const passScene = new THREE.Scene().add(openPass),
    passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const depthFor = object => (!occludes(object) ? null : object.isInstancedMesh ? (object.instanceColor ? depthOf.tinted : depthOf.instanced) : depthOf.plain);
  const pending = Object.assign(new THREE.Vector4(), { due: false }),
    hidden = [],
    dressed = [],
    worn = [],
    _clear = new THREE.Color();
  function drawHeights(atX, atZ) {
    const texel = (2 * config.half) / config.size,
      x = Math.round(atX / texel) * texel,
      z = Math.round(atZ / texel) * texel,
      y = ground(x, z);
    above.position.set(x, y + config.above, z);
    above.updateMatrixWorld();
    const previousTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    const shadows = renderer.shadowMap.autoUpdate, clearAlpha = renderer.getClearAlpha(), fog = scene.fog;
    renderer.getClearColor(_clear);
    try {
      scene.traverse(object => {
        if (!object.visible || !(object.isMesh || object.isPoints || object.isLine || object.isSprite)) return;
        const depth = depthFor(object);
        if (!depth) {
          object.visible = false;
          hidden.push(object);
          return;
        }
        dressed.push(object);
        worn.push(object.material);
        object.material = depth;
      });
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(heights);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      scene.fog = null;
      renderer.render(scene, above);
    } finally {
      scene.fog = fog;
      for (let i = 0; i < dressed.length; i++) dressed[i].material = worn[i];
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      dressed.length = worn.length = hidden.length = 0;
      renderer.setClearColor(_clear, clearAlpha);
      renderer.setRenderTarget(previousTarget, face, level);
      renderer.shadowMap.autoUpdate = shadows;
    }
    pending.set(x - config.half, z + config.half, 1 / (2 * config.half), y);
    pending.due = true;
  }
  function workOutOpenness() {
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(openness);
    try { renderer.render(passScene, passCamera); }
    finally { renderer.setRenderTarget(target, face, level); }
    uniforms.uSkyR.value.copy(pending);
    pending.due = false;
  }

  function warm(root) {
    const done = [warmStandIns(root, depthFor, above, heights, null)];
    if (root === scene) {
      const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
      renderer.setRenderTarget(openness);
      try { done.push(compiled(passScene, passCamera)); }
      finally { renderer.setRenderTarget(target, face, level); }
    }
    return Promise.all(done);
  }

  const drawn = { x: NaN, z: NaN, age: 0 };
  function update(deltaSeconds) {
    const x = camera.position.x,
      z = camera.position.z,
      high = camera.position.y - ground(x, z),
      on = strength(high);
    uniforms.uSkyOn.value = on;
    if (on <= 0 || compilingNow()) return;
    if (pending.due) {
      workOutOpenness();
      return;
    }
    drawn.age += deltaSeconds;
    if (Math.hypot(x - drawn.x, z - drawn.z) < config.step && drawn.age < config.every) return;
    const first = Number.isNaN(drawn.x);
    drawHeights(x, z);
    if (first) workOutOpenness();
    drawn.x = x;
    drawn.z = z;
    drawn.age = 0;
  }
  function dispose() {
    heights.dispose();
    openness.dispose();
    for (const depth of Object.values(depthOf)) depth.dispose();
    openPass.geometry.dispose();
    openPass.material.dispose();
    if (uniforms.uSkyOpen.value === openness.texture) {
      uniforms.uSkyOpen.value = null;
      uniforms.uSkyOn.value = 0;
    }
  }
  return {update, warm, dispose};
}

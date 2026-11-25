import * as THREE from 'three';
import {still, STILL_LAYER} from './still-casters.js';

// Cache the static layer of one point shadow. Mark its casters and install the matching
// shadow depth hooks (custom batch casters may implement keptAway in their own hooks).
export function createStaticPointShadow(renderer) {
  const shadowMap = renderer.shadowMap;
  const renderShadows = shadowMap.render;
  const only = [];
  const view = new THREE.Camera();
  view.layers.set(STILL_LAYER);
  const origin = new THREE.Vector3(NaN, NaN, NaN), current = new THREE.Vector3();
  let light, map, picture, cachedSum, cachedNear, cachedFar, cachedType, stale = true;
  let previousClear;

  function framebuffer(target, face) {
    const fb = renderer.properties.get(target).__webglFramebuffer;
    return target.isWebGLCubeRenderTarget ? fb[face] : fb;
  }

  function copyFace(source, destination, face) {
    const gl = renderer.getContext();
    const {width, height} = destination;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer(source, face));
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer(destination, face));
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer(map, renderer.getActiveCubeFace()));
  }

  function clear(color, depth, stencil) {
    if (renderer.getRenderTarget() === map) copyFace(picture, map, renderer.getActiveCubeFace());
    else previousClear.call(renderer, color, depth, stencil);
  }

  function capture(scene) {
    const shadow = light.shadow;
    still.round++;
    still.sum = 0;
    renderShadows.call(shadowMap, only, scene, view);
    const next = shadow.map;
    if (!next) return false;
    if (next !== map || next.width !== picture?.width || next.height !== picture?.height) {
      picture?.dispose();
      if (next.isWebGLCubeRenderTarget) {
        picture = new THREE.WebGLCubeRenderTarget(next.width);
        const depth = next.depthTexture;
        picture.depthTexture = new depth.constructor(next.width, depth.type);
        picture.depthTexture.format = depth.format;
        picture.depthTexture.compareFunction = depth.compareFunction;
        picture.depthTexture.minFilter = depth.minFilter;
        picture.depthTexture.magFilter = depth.magFilter;
      } else picture = new THREE.WebGLRenderTarget(next.width, next.height);
      renderer.initRenderTarget(picture);
    }
    map = next;
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(map);
      for (let f = 0; f < (map.isWebGLCubeRenderTarget ? 6 : 1); f++) copyFace(map, picture, f);
    } finally { renderer.setRenderTarget(target, face, level); }
    origin.copy(current);
    cachedNear = shadow.camera.near;
    cachedFar = shadow.camera.far;
    cachedType = shadowMap.type;
    cachedSum = still.sum;
    stale = false;
    return true;
  }

  function shadows(lights, scene, camera) {
    const shadow = light.shadow;
    const requested = this.needsUpdate;
    let usable = this.enabled && (this.autoUpdate || requested) && (shadow.autoUpdate || shadow.needsUpdate) &&
      lights.includes(light) && this.type !== THREE.VSMShadowMap && !(shadow.camera.layers.mask & ~1);
    // The membership counters belong to a single light. Full draws remain correct for other point lights.
    if (usable) for (const other of lights) {
      if (other !== light && other.isPointLight) {
        stale = true;
        usable = false;
        break;
      }
    }
    if (!usable) { renderShadows.call(this, lights, scene, camera); return; }
    current.setFromMatrixPosition(light.matrixWorld);
    if (stale || map !== shadow.map || !origin.equals(current) || cachedNear !== shadow.camera.near ||
        cachedFar !== (light.distance || shadow.camera.far) || cachedType !== this.type ||
        (map.isWebGLCubeRenderTarget && map.width !== shadow.mapSize.x)) {
      const captured = capture(scene);
      shadow.needsUpdate = true;
      this.needsUpdate = requested;
      if (!captured) { renderShadows.call(this, lights, scene, camera); return; }
    }
    previousClear = renderer.clear;
    still.kept = true;
    still.sum = 0;
    renderer.clear = clear;
    try {
      renderShadows.call(this, lights, scene, camera);
      stale = still.sum !== cachedSum;
    } finally {
      renderer.clear = previousClear;
      still.kept = false;
    }
  }

  function keep(lightToCache) {
    if (!lightToCache?.isPointLight) throw new TypeError('Expected a point light');
    light = only[0] = lightToCache;
    stale = true;
    shadowMap.render = shadows;
  }
  function dispose() {
    if (shadowMap.render === shadows) shadowMap.render = renderShadows;
    picture?.dispose();
    picture = map = light = null;
    only.length = 0;
  }
  return {keep, stale: () => stale, dispose};
}

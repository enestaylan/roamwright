/**
 * Create the Three.js renderer, scenes and camera used by a Roamwright world.
 * @module
 */

import * as THREE from 'three';

/**
 * Create a shadow-enabled renderer, a perspective camera and a group for world objects.
 * Size the renderer to the canvas and update the camera aspect ratio before rendering.
 * @param {HTMLCanvasElement} canvas - Drawing surface for the WebGL renderer.
 * @param options - Antialiasing, vertical field of view in degrees, and near and far clipping distances in world units.
 * @returns The renderer, main scene, camera, world group and a separate scene for effects.
 */
export function createRenderContext(canvas, { antialias = true, fov = 68, near = 0.25, far = 7000 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = Number(THREE.REVISION) === 170 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  camera.layers.enable(1);
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);
  const fxScene = new THREE.Scene();
  return { renderer, scene, camera, worldGroup, fxScene };
}

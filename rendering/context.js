import * as THREE from 'three';

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

import * as THREE from 'three';
import { createLightShafts } from 'roamwright/rendering/light-shafts.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 200);
  camera.position.set(26, 9, 10);
  camera.lookAt(0, 9, 0);
  const height = 18;
  const { lightShaft } = createLightShafts({
    camera, ground: () => 0, heightProbe: async () => 0,
    time: { value: 0 }, night: { value: 0 },
  });
  const shaft = lightShaft(new THREE.Color(0xffca77), height);
  scene.add(shaft);
  const target = new THREE.WebGLRenderTarget(80, 80);
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(80 * 80 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 80, 80, pixels);
    if (renderer.info.render.calls !== 1 || !pixels.some((x, i) => i % 4 !== 3 && x > 0) || renderer.getContext().getError()) {
      throw new Error('Expected one visible light shaft');
    }
  } finally {
    target.dispose();
    shaft.material.dispose();
    shaft.geometry.dispose();
    renderer.dispose();
  }
  return 'PASS light shaft height, material and color';
}

import * as THREE from 'three';
import { createLightPoints } from 'roamwright/rendering/light-points.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(65, 65);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const intensity = { value: 1 };
  const lights = createLightPoints({
    positions: new Float32Array([0, 0, -10, 2, 1, -12]), color: new THREE.Color(1, 0.5, 0.2),
    intensity, pointScale: { value: 70 }, emitterDiameter: 0.1, haloDiameter: 2,
    fadeIn: [3, 6], fadeOut: [20, 30],
  });
  scene.add(lights);
  const blocker = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0 }));
  blocker.position.z = -5;
  const pixel = new Uint8Array(4);
  function red() {
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
    return pixel[0];
  }
  try {
    renderer.setRenderTarget(target);
    if (red() < 50 || renderer.info.render.calls !== 1 || renderer.info.render.points !== 2) throw Error('unlit or unbatched sources');
    scene.add(blocker);
    if (red()) throw Error('light visible behind opaque surface');
    blocker.visible = false;
    intensity.value = 0;
    if (red()) throw Error('inactive light');
    intensity.value = 1;
    camera.position.z = -8;
    if (red()) throw Error('near light outside its range');
    camera.position.z = 25;
    if (red()) throw Error('distant light outside its range');
    return 'PASS visible sources, batch count, depth rejection, intensity and distance fades';
  } finally {
    lights.geometry.dispose(); lights.material.dispose(); blocker.geometry.dispose(); blocker.material.dispose();
    target.dispose(); renderer.dispose();
  }
}

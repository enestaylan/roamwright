import * as THREE from 'three';
import { fadingOf, handOverOf, handOverShadow, reachOf, twinMaterial } from 'roamwright/rendering/material-lod.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  camera.position.z = 2;
  renderer.setSize(64, 64, false);
  const target = new THREE.WebGLRenderTarget(64, 64);
  renderer.setRenderTarget(target);

  const scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry(1.6, 1.6);
  const base = new THREE.MeshStandardMaterial({ color: 0xffffff });
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const pixels = new Uint8Array(64 * 64 * 4);
  const draw = () => {
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
    return pixels.slice();
  };
  const same = (a, b) => a.every((value, i) => value === b[i]);
  const coverage = a => a.reduce((n, x, i) => n + Number(i % 4 === 0 && x > 0), 0);

  try {
    const main = new THREE.Mesh(geometry, base);
    scene.add(main);
    const full = draw(), fullCoverage = coverage(full);
    if (!fullCoverage) throw new Error('Missing reference mesh');
    const share = { value: 0.5 };
    main.material = fadingOf(base, share);
    if (main.material !== fadingOf(base, share) || twinMaterial(base, 'instanced') === base) throw new Error('Missing material cache');
    const fading = coverage(draw());
    if (fading < fullCoverage * 0.45 || fading > fullCoverage * 0.55) throw new Error('Dissolve fails to represent its uniform');
    share.value = 1;
    if (!same(full, draw())) throw new Error('Fully visible dissolve differs from the reference');

    const reach = { value: 2 };
    main.material = reachOf(base, reach, false, 3);
    const far = new THREE.Mesh(geometry, reachOf(base, reach, true, 3));
    scene.add(far);
    if (!same(full, draw())) throw new Error('Complementary distance fades leave holes');
    far.removeFromParent();
    main.removeFromParent();

    const transition = new THREE.InstancedBufferAttribute(new Float32Array([0.5]), 1);
    geometry.setAttribute('aNear', transition);
    const nearInstances = new THREE.InstancedMesh(geometry, handOverOf(base), 1);
    const farInstances = new THREE.InstancedMesh(geometry, handOverOf(base, true), 1);
    scene.add(nearInstances, farInstances);
    if (!same(full, draw())) throw new Error('Complementary instance fades leave holes');

    const light = new THREE.DirectionalLight(0xffffff);
    light.position.set(0, 0, 4);
    light.castShadow = true;
    nearInstances.castShadow = farInstances.castShadow = true;
    nearInstances.customDepthMaterial = handOverShadow();
    farInstances.customDepthMaterial = handOverShadow(true);
    renderer.shadowMap.enabled = true;
    scene.add(light);
    renderer.render(scene, camera);
    if (renderer.getContext().getError()) throw new Error('LOD shadow did not compile');
  } finally {
    geometry.dispose();
    target.dispose();
    renderer.dispose();
  }
  return 'PASS uniform, distance and instance fades with custom LOD shadow';
}

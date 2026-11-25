import * as THREE from 'three';
import { createCloudField } from 'roamwright/rendering/cloud-field.js';
import { createCloudDome } from 'roamwright/rendering/cloud-dome.js';
import { createSky } from 'roamwright/rendering/sky.js';
import { installHeightHaze } from 'roamwright/rendering/height-haze.js';

export async function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(64, 32);
  const field = createCloudField();
  const dome = createCloudDome({ renderer, field, warmProgram: () => {} });
  const sky = createSky({ field, dome });
  const fog = installHeightHaze();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 2, 0.1, 100);
  camera.lookAt(0, 1, -1);
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(0xb0c0e0, 0.02);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 12), new THREE.MeshBasicMaterial({ color: 0x226622 }));
  ground.position.set(0, -1, -4);
  scene.add(ground);
  const sheet = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(210), 4, 4);
  const volume = new THREE.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4).fill(200), 4, 4, 4);
  volume.format = THREE.RGBAFormat;
  sheet.needsUpdate = volume.needsUpdate = true;
  field.uniforms.uCloudField.value = sheet;
  field.billows.value = volume;
  const target = new THREE.WebGLRenderTarget(64, 32);
  const light = new THREE.Vector3(1, 1, -1).normalize();
  try {
    renderer.setRenderTarget(target);
    await dome.setDetail({ size: 32, frames: 4, steps: 8, most: 12, light: 2, first: 0.1, grow: 1.6, fine: 0 });
    field.place(0, 0, new THREE.Vector2(), light, 0.4, 1);
    const u = sky.material.uniforms;
    u.uCloudDir.value.copy(light);
    u.uSunDir.value.copy(light);
    u.uMoonDir.value.copy(light).negate();
    u.uSunCol.value.setRGB(1, 1, 1);
    u.uCloudLight.value.setRGB(1, 1, 1);
    u.uZenith.value.setRGB(0.1, 0.4, 0.8);
    u.uHorizon.value.setRGB(0.7, 0.8, 1);
    fog.setHaze(light, 0, { fall: 0.1, floor: 0.25 }, u.uZenith.value, u.uHorizon.value, 1, 0, 0, 0);
    for (let i = 0; i < 8; i++) dome.update(0.1, light, 0.4, i, 1, scene);
    if (renderer.getRenderTarget() !== target || !dome.uniforms.uDome.value) throw new Error('Cloud map target was lost');
    renderer.render(scene, camera);
    const buffer = new Uint8Array(64 * 32 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 64, 32, buffer);
    let min = 255,
      max = 0;
    for (let i = 0; i < buffer.length; i += 4) {
      min = Math.min(min, buffer[i]);
      max = Math.max(max, buffer[i]);
    }
    if (max - min < 8 || renderer.info.render.calls !== 2)
      throw new Error('Expected a shaded sky and one fogged ground mesh');
    return 'Sky, banded clouds and height fog rendered in 2 draws on r' + THREE.REVISION;
  } finally {
    renderer.setRenderTarget(null);
    sky.dispose();
    await dome.dispose();
    fog.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
    target.dispose();
    sheet.dispose();
    volume.dispose();
    renderer.dispose();
  }
}

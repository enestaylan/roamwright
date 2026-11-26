import * as THREE from 'three';
import { createRainStreaks } from 'roamwright/rendering/rain-streaks.js';
import { createWind } from 'roamwright/motion/wind.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(160, 160);
  const wind = createWind();
  let seed = 1;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const rain = createRainStreaks({ capacity: 4096, windUniforms: wind.uniforms, random });
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 40);
  const scene = new THREE.Scene();
  scene.add(rain.mesh);
  function capture(intensity) {
    rain.update(camera.position, 1, intensity, 0.5);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(160 * 160 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 160, 160, pixels);
    return pixels;
  }
  try {
    renderer.setRenderTarget(target);
    wind.update(1, 0.5);
    const wet = capture(1);
    if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 4096 ||
        !wet.some((v, i) => i % 4 !== 3 && v)) throw Error('Expected visible instanced rain');
    wind.uniforms.uWindDrift.value.x += 3;
    if (capture(1).every((v, i) => v === wet[i])) throw Error('Wind drift should move the drops');
    if (capture(0).some((v, i) => i % 4 !== 3 && v) || renderer.info.render.calls) throw Error('Expected a dry frame');
    return 'PASS rain visibility, drift and instance budget';
  } finally {
    rain.mesh.geometry.dispose();
    rain.mesh.material.dispose();
    target.dispose();
    renderer.dispose();
  }
}

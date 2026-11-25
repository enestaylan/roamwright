import * as THREE from 'three';
import { createParticleSystem } from 'roamwright/rendering/particles.js';
import { createNoiseLoop, createSpatialPanner, placeListener } from 'roamwright/runtime/spatial-audio.js';

export async function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.z = 3;
  try {
    renderer.setSize(96, 96, false);
    const scene = new THREE.Scene();
    let time = 0;
    const texture = new THREE.DataTexture(new Uint8Array([160, 128, 128, 180]), 1, 1);
    texture.needsUpdate = true;
    const particles = createParticleSystem({
      scene, pointScale: { value: 100 }, elapsed: () => time, noiseTexture: () => texture,
      sceneDepth: { uDepth: { value: null }, uDepthPx: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } },
      random: () => 0.25,
    });
    for (const additive of [false, true]) {
      const pool = particles.makeParticles(4, additive);
      Object.assign(particles.spawn, { x: additive ? 0.1 : -0.1, r: 0.9, g: 0.6, b: 0.4, life: 2, size: 0.6 });
      particles.pSpawn(pool);
      particles.pFlush(pool);
    }
    time = particles.fxU.uTime.value = 0.5;
    particles.fxU.uSunC.value.setRGB(1, 1, 1);
    particles.fxU.uSkyC.value.setRGB(1, 1, 1);
    const target = new THREE.WebGLRenderTarget(96, 96);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(96 * 96 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 96, 96, pixels);
    if (renderer.info.render.calls !== 2 || !pixels.some((x, i) => i % 4 !== 3 && x > 0) || renderer.getContext().getError()) {
      throw new Error('Expected two visible particle draws');
    }
    target.dispose();
    texture.dispose();
  } finally {
    renderer.dispose();
  }

  const audio = new OfflineAudioContext(2, 2048, 8000);
  const source = audio.createBufferSource();
  let seed = 1;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  source.buffer = createNoiseLoop(audio, { seconds: 0.25, crossfade: 0.025, random });
  camera.updateMatrixWorld();
  placeListener(audio.listener, camera.matrixWorld);
  const pan = createSpatialPanner(audio, 2, 0, 0);
  source.connect(pan).connect(audio.destination);
  source.start();
  const result = await audio.startRendering();
  const energy = channel => result.getChannelData(channel).reduce((sum, x) => sum + x * x, 0);
  if (!(energy(1) > energy(0) && energy(0) > 0)) throw new Error('Audio should be louder on the right');
  return 'PASS additive and alpha draws, and spatial audio';
}

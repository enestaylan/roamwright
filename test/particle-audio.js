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
    const pools = [];
    for (const additive of [false, true]) {
      const pool = particles.makeParticles(4, additive);
      Object.assign(particles.spawn, { x: additive ? 0.1 : -0.1, r: 0.9, g: 0.6, b: 0.4, life: 2, size: 0.6 });
      particles.pSpawn(pool);
      particles.pFlush(pool);
      pools.push(pool);
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
    if (pools.some(pool => pool.pts.geometry.instanceCount !== 1)) throw Error('Unused slots were submitted');
    for (const pool of pools) pool.pts.geometry.instanceCount = pool.cap;
    renderer.render(scene, camera);
    const reference = new Uint8Array(pixels.length);
    renderer.readRenderTargetPixels(target, 0, 0, 96, 96, reference);
    if (!pixels.every((value, i) => value === reference[i])) throw Error('Clipping unused slots changed particles');
    for (const pool of pools) {
      // Fill the ring and start a new lap with a particle that outlives the old lap.
      particles.spawn.life = 1;
      for (let i = 1; i < pool.cap; i++) particles.pSpawn(pool);
      particles.spawn.life = 5;
      particles.pSpawn(pool);
      particles.pFlush(pool);
      if (pool.pts.geometry.instanceCount !== pool.cap) throw Error('Live particles lost at wrap');
    }
    time = particles.fxU.uTime.value = 2.5;
    for (const pool of pools) {
      particles.pFlush(pool);
      if (!pool.pts.visible || pool.pts.geometry.instanceCount !== 1) throw Error('Expired tail still submitted');
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

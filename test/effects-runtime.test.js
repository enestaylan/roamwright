import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, Scene, Texture } from 'three';
import { particleNoise } from '../math/particle-noise.js';
import { createDailyClock } from '../motion/daily-clock.js';
import { createParticleSystem } from '../rendering/particles.js';
import { createDeviceQuality } from '../runtime/device-quality.js';
import { createNoiseLoop, placeListener } from '../runtime/spatial-audio.js';

test('the daily clock samples once per frame and distinguishes midnight from a jump', () => {
  let frame = 0, hour = 23.995, reads = 0;
  const clock = createDailyClock({ getFrame: () => frame, getHour: () => { reads++; return hour; } });
  assert.equal(clock.clockTurned(), true);
  assert.equal(clock.hourNow(), hour);
  assert.equal(reads, 1);
  assert.equal(clock.isOut([20, 22], [2, 4], 0.5, 2), true);
  frame++;
  hour = 0.01;
  assert.equal(clock.clockTurned(), false);
  assert.equal(clock.shareOut([20, 22], [2, 4]), 1);
  assert.equal(clock.hoursApart(23, 3), 4);
  frame++;
  hour = 13;
  assert.equal(clock.clockTurned(), true);
});

test('device quality caches the GPU name and still reads current device settings', () => {
  let queries = 0, memory = 16, handheld = false;
  const gl = { RENDERER: 1, getExtension: () => null, getParameter() { queries++; return 'Apple GPU'; } };
  const quality = createDeviceQuality({ renderer: { getContext: () => gl }, handheld: () => handheld, memoryGB: () => memory });
  assert.equal(quality.deviceQuality(), 'high');
  handheld = true;
  assert.equal(quality.deviceQuality(), 'medium');
  memory = 4;
  assert.equal(quality.deviceQuality(), 'low');
  assert.equal(quality.drawnInSoftware(), false);
  assert.equal(queries, 1);
});

test('particle uploads track dirty ranges, wrap and expire', () => {
  const scene = new Scene();
  let time = 3, textures = 0;
  const particles = createParticleSystem({ scene, elapsed: () => time, pointScale: { value: 10 }, noiseTexture: () => { textures++; return new Texture(); }, random: () => 0.25 });
  const alpha = particles.makeParticles(2, false);
  particles.makeParticles(2, true);
  assert.equal(textures, 1);
  Object.assign(particles.spawn, { x: 2, life: 1, size: 4 });
  particles.pSpawn(alpha);
  particles.pFlush(alpha);
  assert.deepEqual([...alpha.dat.slice(0, 4)], [3, 1, 4, 0]);
  assert.deepEqual([...alpha.sed.slice(0, 2)], [0.25, 0.5]);
  assert.deepEqual(alpha.attrs[0].updateRanges, [{ start: 0, count: 3 }]);
  particles.pSpawn(alpha);
  particles.pFlush(alpha);
  assert.deepEqual(alpha.attrs[0].updateRanges, []);
  time = 4;
  particles.pFlush(alpha);
  assert.equal(alpha.pts.visible, false);
  assert.equal(scene.children.length, 2);
});

test('particle noise is repeatable and varies with the seed', () => {
  const at = (fill) => {
    const out = new Uint8Array(4);
    fill(0.21, 0.47, out);
    return [...out];
  };
  const options = { size: 32, ridgeSeed: 198, cloudSeed: 184 };
  const first = at(particleNoise(options));
  assert.deepEqual(at(particleNoise(options)), first);
  assert.notDeepEqual(at(particleNoise({ ...options, ridgeSeed: 199 })), first);
});

test('silent pink noise remains finite and the listener follows world pose', () => {
  const context = {
    sampleRate: 64,
    createBuffer: (_channels, length) => {
      const samples = new Float32Array(length);
      return { getChannelData: () => samples };
    },
  };
  const samples = createNoiseLoop(context, { pink: true, seconds: 2, random: () => 0.5 }).getChannelData(0);
  assert.equal(samples.length, 128);
  assert.ok(samples.every(x => x === 0));
  const listener = Object.fromEntries(['position', 'forward', 'up'].flatMap(key => ['X', 'Y', 'Z'].map(axis => [key + axis, { value: NaN }])));
  placeListener(listener, new Matrix4().makeTranslation(2, 3, 4));
  assert.deepEqual([listener.positionX.value, listener.positionY.value, listener.positionZ.value], [2, 3, 4]);
  assert.equal(listener.forwardZ.value, -1);
  assert.equal(listener.upY.value, 1);
});

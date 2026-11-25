import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector2, Vector3, UniformsLib, ShaderChunk } from 'three';
import { createCloudTextures } from 'roamwright/math/cloud-textures.js';
import { createWind } from 'roamwright/motion/wind.js';
import { createWeather } from 'roamwright/motion/weather.js';
import { createCloudField } from 'roamwright/rendering/cloud-field.js';
import { createSunMoonCycle, createHazeFollower } from 'roamwright/rendering/daylight.js';
import { installHeightHaze } from 'roamwright/rendering/height-haze.js';

test('a seeded cloud sheet is periodic and its coverage matches the terrain shadow channel', () => {
  const textures = createCloudTextures({ seed: 42, volumeSeed: 17 });
  const field = textures.field(),
    volume = textures.volume(),
    a = new Uint8ClampedArray(4),
    b = a.slice();
  for (let i = 0; i < 24; i++) {
    const u = i / 32,
      v = ((i * 7) % 32) / 32;
    field(u, v, a);
    field(u + 1, v - 2, b);
    assert.deepEqual(a, b);
    assert.ok(Math.abs((a[0] + a[3] / 255 - 0.5) / 255 - textures.coverage(u, v)) < 0.00001);
    volume(u, v, a, 0.5);
    volume(u, v, b, 1.5);
    assert.deepEqual(a, b);
  }
});

test('wind, weather, cloud projection and daylight can run in independent worlds', () => {
  const breeze = createWind(),
    other = createWind();
  breeze.update(20, 1);
  assert.equal(breeze.wind.gust, 1);
  assert.equal(other.uniforms.uWindDrift.value.length(), 0);
  const field = createCloudField({ windFactor: 3 });
  const angle = createSunMoonCycle();
  const sun = new Vector3(),
    moon = new Vector3();
  assert.equal(angle(0, 0, 0, sun, moon), 0);
  assert.ok(Math.abs(sun.length() - 1) < 1e-9 && Math.abs(moon.length() - 1) < 1e-9);
  field.place(0, 0, new Vector2(30, 50), sun, 0.4, 1);
  assert.ok(field.overhead.z > 0);
  const follow = createHazeFollower({ fixedHeight: 2 });
  assert.equal(follow(1, 0, 0, 20, 1), 20);
  assert.ok(follow(1, 1, 0, 40, 1) > 20);
  assert.equal(follow(1, 2, 0, 100, null), 2);
  const weather = createWeather({ random: () => 0.5 });
  const state = { wet: 0, rain: 0, damp: 0, gust: 0, dust: 0, dustStorm: 0, mist: 0, storm: 1 };
  const region = { spell: 'squall', every: [10, 12], lasts: [3, 5] };
  for (let i = 0; i < 64; i++) weather(state, 1, 0.4, { region, weather: region, x: 0, z: 0 });
  assert.equal(state.rain, 1);
  assert.equal(state.gust, 1);
  weather(state, 1, 0.4, { ambientDust: 0.7 });
  assert.equal(state.rain, 0);
  assert.equal(state.dust, 0.7);
});

test('height haze installs and releases Three.js fog chunks and uniforms', () => {
  const previous = ShaderChunk.fog_fragment;
  const haze = installHeightHaze();
  assert.notEqual(ShaderChunk.fog_fragment, previous);
  haze.setMist(3, 5, 0.7);
  assert.equal(UniformsLib.fog.uHaze.value[16], 3);
  haze.dispose();
  assert.equal(ShaderChunk.fog_fragment, previous);
  assert.equal(UniformsLib.fog.uHaze, undefined);
});

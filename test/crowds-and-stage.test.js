import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCrowdAlarms } from '../motion/crowd-alarms.js';
import { createWalkFit, detailLevel, easeHeading, followRoutine } from '../motion/crowd-routine.js';
import { createSpaces } from '../motion/spaces.js';
import { createLightBudget, createShadowRedraw } from '../rendering/light-budget.js';
import { createParticleEmitters, shakeOffset } from '../rendering/particle-emitters.js';
import { birdGeometry, createFlock, plainBirdGeometry, plumage } from '../rendering/flocks.js';
import { createCellLod } from '../rendering/cell-lod.js';
import { cameraKeyAt, createNarrowFraming, createStageLights } from '../rendering/stage-lights.js';
import { mulberry32 } from '../math/random.js';

test('an alarm scatters a person round a wall and they walk back once it is quiet', () => {
  const s = createSpaces({ id: 'world' });
  s.addCircle(s.worldSpace, 2, 0, 0.6);
  const alarms = createCrowdAlarms({ steer: s.steer });
  const g = { ph: 0.3, ft: -1 },
    at = { x: 0, z: 0, yaw: 0, speed: 0, travel: 0, focus: 'talk' };
  alarms.raise(-1, 0, 0);
  alarms.raise(-1.5, 0, 0.5, 20); // renews the one within 3 m
  assert.equal(alarms.alarms.length, 1);
  assert.equal(alarms.alarms[0].r, 20);
  let t = 0;
  for (let i = 0; i < 120; i++) {
    t += 1 / 30;
    at.x = at.z = 0;
    alarms.flee(g, at, t);
  }
  assert.ok(Math.hypot(g.fx, g.fz) > 3, 'ran away');
  assert.ok(!s.collide(at.x, at.z, 0.3), 'not through the wall');
  assert.equal(at.focus, undefined);
  alarms.expire(t + 10);
  assert.equal(alarms.alarms.length, 0);
  for (let i = 0; i < 900 && (g.fx || g.fz); i++) {
    t += 1 / 30;
    at.x = at.z = 0;
    alarms.flee(g, at, t);
  }
  assert.equal(g.fx, 0, 'walked back');
  assert.equal(alarms.alarmed(g), false);
  alarms.watch(10, 0);
  const idle = { x: 0, z: 0, yaw: 1 };
  alarms.watchStage(idle);
  assert.equal(idle.yaw, Math.PI / 2);
  alarms.watch();
  idle.yaw = 1;
  alarms.watchStage(idle);
  assert.equal(idle.yaw, 1);
});

test('routines walk legs with eased starts, circles and ways to and fro', () => {
  const at = {};
  const g = {
    ax: 0,
    az: 0,
    ph: 0,
    T: 10,
    walkSpeed: 1.2,
    legs: [
      { t0: 0, tw: 4, x0: 0, z0: 0, dx: 4, dz: 0, dir: Math.PI / 2, len: 4, travel: 0, start: true, stop: true },
      { t0: 4, tw: 0, x0: 4, z0: 0, dx: 0, dz: 0, dir: 0, len: 0, travel: 4, role: 'sit', hide: false },
    ],
  };
  assert.equal(followRoutine(g, 0.05, at), true);
  assert.ok(at.speed > 0 && at.speed < 1.2, 'easing in');
  followRoutine(g, 2, at);
  assert.equal(at.speed, 1.2);
  assert.equal(at.x, 2);
  followRoutine(g, 6, at, () => 0.5);
  assert.equal(at.focus, 'sit');
  assert.equal(at.head, 0.5);
  g.legs[1].hide = true;
  assert.equal(followRoutine(g, 6, at), false);
  const walker = { ax: 0, az: 0, ph: 0, sp: 1, len: 4, dx: 4, dz: 0, pathYaw: Math.PI / 2 };
  followRoutine(walker, 6, at);
  assert.equal(at.x, 2);
  assert.equal(at.yaw, Math.PI / 2 + Math.PI, 'turned back');
  const round = { ax: 0, az: 0, ph: 0, r: 2, w: 1 };
  followRoutine(round, 0, at);
  assert.equal(at.x, 2);
  assert.equal(at.speed, 2);
});

test('walks are fitted short of walls, and standers are set outside them', () => {
  const s = createSpaces({ id: 'world' });
  s.addCircle(s.worldSpace, 5, 0, 1);
  s.addCircle(s.worldSpace, 0, 10, 1);
  const fitWalk = createWalkFit(s);
  const walker = { ox: 0, oz: 0, bx: 10, bz: 0, sp: 1 };
  fitWalk(walker, s.worldSpace);
  assert.equal(walker.len, 10, 'stopped soon by the wall, it walks the longer way back from its spot');
  assert.equal(walker.pathYaw, -Math.PI / 2);
  const hemmed = { ox: 0, oz: 0, bx: 10, bz: 0, sp: 1 };
  s.addCircle(s.worldSpace, -3, 0, 1);
  fitWalk(hemmed, s.worldSpace);
  assert.ok(hemmed.len > 2 && hemmed.len < 4, 'short of the nearer wall');
  assert.equal(hemmed.pathYaw, Math.PI / 2);
  const stander = { ox: 0.2, oz: 10 };
  fitWalk(stander, s.worldSpace);
  assert.ok(Math.hypot(stander.ax, stander.az - 10) >= 1, "set outside the collider");
  assert.equal(stander.fit, 3);
});

test('levels of detail hold on their edges and headings ease', () => {
  const N = [15.3, 16.5],
    M = [25, 27],
    L = [39, 41];
  assert.equal(detailLevel(16 ** 2, 3, 1, N, M, L), 3);
  assert.equal(detailLevel(16 ** 2, 2, 1, N, M, L), 2);
  assert.equal(detailLevel(40 ** 2, 0, 1, N, M, L), 0);
  assert.equal(detailLevel(40 ** 2, 1, 1, N, M, L), 1);
  assert.equal(detailLevel(40 ** 2, 0, 2, N, M, L), 2);
  assert.equal(easeHeading(0, 1, 1, 2), 1);
  assert.equal(easeHeading(0, 1, 0.05, 2), 0.1);
  assert.ok(Math.abs(easeHeading(3, -3, 0.05, 2) - (3 + (2 * Math.PI - 6) * 0.1)) < 1e-12, 'the short way round');
});

test('the light budget lights the strongest sources in view, fades and never switches a light off', () => {
  const parent = new THREE.Group(),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  camera.updateMatrixWorld();
  const budget = createLightBudget({ parent, count: 2, strength: s => s.power, flicker: () => 1 });
  const source = (z, power) => ({ x: 0, y: 1, z, r: 1, g: 0.6, b: 0.3, power, reach: 10, held: -1, flicker: 1 });
  const near = source(-5, 2),
    far = source(-30, 2),
    behind = source(6, 2),
    weak = source(-6, 0.01);
  budget.begin(camera);
  for (const s of [near, far, behind, weak]) budget.consider(s, 0, 2, 0, 1);
  budget.settle();
  assert.deepEqual(
    budget.picked.map(s => s.z),
    [-5, 6],
  );
  assert.equal(parent.children.length, 2);
  const lead = budget.fadeLights(0.1, 0, 1);
  assert.ok(budget.lights[near.held].intensity > 0);
  assert.equal(budget.lights[lead].position.z, -5);
  for (let i = 0; i < 40; i++) budget.fadeLights(0.1, 0, 1);
  assert.equal(budget.lights[near.held].intensity, 2);
  assert.equal(budget.due(0.1), true);
  assert.equal(budget.due(0.1), false);
  budget.soon();
  assert.equal(budget.due(0), true);
  const redraw = createShadowRedraw();
  const L = budget.lights[0];
  L.castShadow = true;
  assert.equal(redraw(L, 2, () => 1, () => false), true);
  assert.equal(L.shadow.needsUpdate, true);
  L.shadow.needsUpdate = false;
  L.shadow.map = {};
  assert.equal(redraw(L, 4, () => 1, () => false), false, 'nothing moved');
  assert.equal(redraw(L, 6, () => 2, () => false), true, 'something moved');
  assert.equal(redraw(L, 7, () => 3, () => false), false, 'not this frame');
});

test('emitters fill the spawn record and hand each particle over', () => {
  const spawn = {},
    put = [];
  const emit = createParticleEmitters({ spawn, put: pool => put.push([pool, spawn.y, spawn.e1]), random: mulberry32(7) });
  emit.mist({ x: 0, z: 0, r: 5, size: 3 }, () => 10, 0, 'alpha');
  assert.ok(put[0][1] >= 10.25 && put[0][1] <= 10.85);
  emit.smoke({ x: 0, y: 0, z: 0, size: 2 }, 'alpha');
  for (let i = 0; i < 50; i++) emit.fire({ x: 0, y: 0, z: 0, size: 1, sparks: 1, halo: 1, soot: 1 }, 'add', 'alpha');
  assert.equal(put.length, 2 + 50 * 4);
  assert.equal(put.filter(([pool]) => pool === 'add').length, 150);
  const v = shakeOffset(new THREE.Vector3(), 1, 0, 1);
  assert.equal(v.length(), 0, 'spent');
  assert.ok(shakeOffset(new THREE.Vector3(), 1, 0.5, 1).length() < 0.18);
});

test('birds are built from their look, and a flock wheels, banks and keeps from the lens', () => {
  const crow = {
    arm: [
      [0.16, 0.02, 0.28, 0.16, 0.02, -0.22],
      [0.8, 0.04, 0.3, 0.8, 0.02, -0.34],
    ],
    hand: [
      [0.8, 0.04, 0.3, 0.8, 0.02, -0.34],
      [1.62, 0, -0.08, 1.62, 0, -0.08],
    ],
    fingers: [[1.32, -0.2, 0.02, -0.22]],
    tail: [1.08, 0.2],
    beat: 3.4,
  };
  const g = birdGeometry(crow);
  assert.equal(g.attributes.position.count, (66 + 3 + 2 * (2 + 2 + 1)) * 3);
  assert.equal(g.attributes.color, undefined);
  assert.equal(plainBirdGeometry().attributes.position.count, 12);
  assert.ok(plumage(0x010101).r > new THREE.Color(0x010101).r, "a near-black plumage is lifted");
  const lens = new THREE.PerspectiveCamera();
  lens.position.set(0, 50, 0);
  const sounds = [];
  const flock = createFlock({
    count: 6,
    color: 0x111111,
    size: 1,
    look: crow,
    time: { value: 0 },
    lens,
    random: mulberry32(3),
    calls: { sound: (...a) => sounds.push(a), heard: 1e6, gap: [0, 0] },
  });
  for (let t = 0; t < 2; t += 0.1) flock.update(0, 50, 0, 20, 4, t);
  const m = flock.mesh.instanceMatrix.array;
  for (let i = 0; i < 6; i++) assert.ok(Math.hypot(m[i * 16 + 12], m[i * 16 + 13] - 50, m[i * 16 + 14]) >= 16 - 1e-4, 'kept clear (float32 matrices)');
  assert.ok(sounds.length > 0);
  assert.equal(flock.reach(4), 13, "its height and the bob, at most 9 m");
});

test('cells show their near mesh near, their batched far copy far, and nothing past the distance', () => {
  const geo = new THREE.BoxGeometry(),
    mat = new THREE.MeshStandardMaterial();
  mat.onBeforeCompile = () => {};
  const cell = (cx, n) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n),
      lo = new THREE.InstancedMesh(geo, mat, n);
    return { mesh, lo, cx, cz: 0, r: 10, full: n };
  };
  const cells = [cell(0, 4), cell(300, 4), cell(2000, 4)],
    parent = new THREE.Group(),
    lod = createCellLod();
  lod.batch(cells, parent);
  assert.equal(parent.children.length, 2, 'one batch for each 500 m square');
  lod.update(cells, 0, 0, 1000, 100, 1);
  assert.equal(cells[0].mesh.visible, true);
  assert.equal(cells[1].mesh.visible, false);
  assert.equal(lod.batches[0].visible, true);
  assert.equal(lod.batches[1].visible, false);
  assert.equal(cells[1].mesh.count, 4);
  lod.update(cells, 0, 0, 500, 100, 1);
  assert.equal(cells[1].mesh.count, 2, 'thinned past 45% of the distance');
});

test('stage lights cut at a jump and keep their strength on the subject; keys and narrow framing', () => {
  const fill = new THREE.SpotLight(),
    rim = new THREE.SpotLight(),
    bounce = new THREE.PointLight();
  const stage = createStageLights({ fill, rim, bounce });
  const p = new THREE.Vector3(10, 2, 0),
    l = new THREE.Vector3(0, 1, 0);
  assert.equal(stage.update(p, l, false, 0, 1 / 60), true, 'the first frame is a cut');
  const night = fill.intensity;
  assert.ok(night > 0 && rim.intensity > 0);
  assert.equal(stage.update(p, l, false, 0, 1 / 60), false);
  assert.ok(Math.abs(fill.intensity - night) < 1e-9);
  stage.update(p, l, true, 1, 1);
  assert.equal(fill.target.position.distanceTo(l), 0, 'a closer shot aims its key at the subject');
  const keys = [
    [0, 0, 0, 0, 0, 0, 0],
    [2, 2, 0, 0, 0, 0, 0],
    [4, 9, 0, 0, 0, 0, 0, 1],
  ];
  const at = cameraKeyAt(keys, 1, {});
  assert.equal(at.src, keys[0]);
  assert.equal(at.u, 0.5);
  assert.equal(cameraKeyAt(keys, 3, {}).dst, keys[1], 'a cut holds');
  assert.equal(cameraKeyAt(keys, 4.5, {}).src, keys[2]);
  const frame = createNarrowFraming({ blocked: () => false });
  const shot = { p: new THREE.Vector3(10, 0, 0), l: new THREE.Vector3(), drawn: -1 };
  const lens = frame(shot, 10, 1 / 60, 60, 60, 0.6);
  assert.ok(shot.p.x > 10 && lens >= 60 - 5.5);
});

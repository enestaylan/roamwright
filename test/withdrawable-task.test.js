import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWithdrawableTask } from 'roamwright/runtime/withdrawable-task.js';
import { createHandOver } from 'roamwright/runtime/hand-over.js';
import { createFirstUse } from 'roamwright/runtime/first-use.js';
import { createCompilationSchedule } from 'roamwright/rendering/compilation-schedule.js';
import { disposeMeshRoots } from 'roamwright/rendering/dispose-meshes.js';

test('concurrent demand pins an optional attempt, failed attempts and withdrawals can retry', async () => {
  const calls = [], finishing = [];
  const task = createWithdrawableTask(async (id, signal) => {
    calls.push(id);
    await new Promise(resolve => finishing.push(resolve));
    if (id === 1) throw Error('fixture failure');
    signal.throwIfAborted();
    return id;
  });
  const first = task.request(1);
  assert.equal(task.request(2, true), first);
  assert.equal(task.withdraw(), false);
  await Promise.resolve();
  finishing.shift()();
  await assert.rejects(first, /fixture failure/);
  const old = task.request(3);
  await Promise.resolve();
  assert.equal(task.withdraw(), true);
  const next = task.request(4, true);
  assert.deepEqual(calls, [1, 3]);
  finishing.shift()();
  await assert.rejects(old, {name: 'AbortError'});
  await Promise.resolve();
  finishing.shift()();
  assert.equal(await next, 4);
  assert.equal(task.pending, false);
});

test('withdrawal restores temporary draws immediately and closes paused generators', async () => {
  const paints = [];
  const upload = createHandOver({frameShare: () => 1, painted: () => new Promise(resolve => paints.push(resolve))});
  upload.frameDrawn();
  const a = new THREE.Mesh(new THREE.BoxGeometry()), b = new THREE.Mesh(new THREE.BoxGeometry());
  for (const mesh of [a,b]) {
    mesh.visible = false;
    mesh.geometry.attributes.position.onUpload(() => {});
    mesh.geometry.setDrawRange(1, 6);
  }
  let controller = new AbortController();
  const started = upload.handToCard([a,b], controller.signal);
  await Promise.resolve();
  assert.equal(a.visible, true);
  assert.equal(b.visible, false);
  controller.abort();
  assert.deepEqual(a.geometry.drawRange, {start:1,count:6});
  assert.equal(a.visible, false);
  assert.equal(a.frustumCulled, true);
  paints.shift()();
  await assert.rejects(started, {name:'AbortError'});
  assert.equal(paints.length, 0);
  let closed = false;
  function* steps() { try { yield 1; assert.fail('obsolete upload'); } finally { closed = true; } }
  controller = new AbortController();
  const parts = upload.paced(steps(), controller.signal);
  controller.abort();
  paints.shift()();
  await assert.rejects(parts, {name:'AbortError'});
  assert.equal(closed, true);
  assert.throws(() => upload.drain(steps(), controller.signal), {name:'AbortError'});
});

test('abort skips shader first use while another caller can still use a shared program', async () => {
  const used = [];
  const renderer = { info: {programs:[]}, debug: {checkShaderErrors:false}, getContext: () => ({}) };
  const queue = createFirstUse({renderer, now:() => 0});
  const scene = {}, warm = createCompilationSchedule({
    renderer, scene, ...queue,
    beginCompiles(root, warmed, blocking, signal) {
      if (root === scene) return;
      assert.ok(signal);
      renderer.info.programs.push({program:{},getUniforms(){used.push(1);}});
    }
  });
  await warm.warmShaders();
  queue.useAtFrameStart();
  const controller = new AbortController();
  const request = warm.warmShaders({}, {signal:controller.signal});
  await Promise.resolve();
  const pinned = queue.putToUse(renderer.info.programs);
  controller.abort();
  await assert.rejects(request, {name:'AbortError'});
  assert.deepEqual(used, []);
  queue.useAtFrameStart();
  await pinned;
  assert.deepEqual(used, [1]);
});

test('dispose live children, private geometry once, instance buffers and owned batch storage', () => {
  const root=new THREE.Group(), shared=new THREE.BoxGeometry(), own=new THREE.BoxGeometry();
  const mesh=new THREE.InstancedMesh(shared, new THREE.MeshBasicMaterial(), 1);
  let instances=0, privates=0, batches=0;
  shared.addEventListener('dispose', () => assert.fail('shared geometry disposed'));
  mesh.material.addEventListener('dispose', () => assert.fail('shared material disposed'));
  own.addEventListener('dispose', () => privates++);
  mesh.addEventListener('dispose', () => instances++);
  const batch = new THREE.Mesh();
  batch.isPieceBatch = true;
  batch.free = () => batches++;
  root.add(mesh, new THREE.Mesh(own), new THREE.Mesh(own), batch);
  disposeMeshRoots(root.children, new Set([shared]));
  assert.deepEqual([instances,privates,batches,root.children.length], [1,1,1,0]);
});

test('a stalled compile has a deadline and cannot start first use after cancellation', async () => {
  const scene = {}, renderer = {info:{programs:[]}};
  let active;
  const warm = createCompilationSchedule({
    scene, renderer, timeoutMs:5,
    beginCompiles(root, warmed, blocking, signal) {
      active = signal;
      return new Promise(() => {});
    },
    putToUse() { assert.fail('stale program use'); },
  });
  const controller = new AbortController();
  await assert.rejects(warm.warmShaders({}, {signal:controller.signal}), /timed out/);
  assert.ok(active.aborted);
  const retry = warm.warmShaders({}, {signal:controller.signal});
  controller.abort();
  await assert.rejects(retry, {name:'AbortError'});
});

test('a fresh root reclaims programs linked by its interrupted predecessor', async () => {
  const scene = {}, retryKey = {}, renderer = {info:{programs:[]}}, program = {}, used=[];
  const warm = createCompilationSchedule({scene, renderer,
    beginCompiles(root) {
      if (root === scene || renderer.info.programs.length) return;
      renderer.info.programs.push(program);
      return new Promise(() => {});
    },
    putToUse(programs) { used.push(...programs); }
  });
  await warm.warmShaders();
  const first = new AbortController();
  const partial = warm.warmShaders({}, {signal:first.signal, retryKey});
  first.abort();
  await assert.rejects(partial, {name:'AbortError'});
  const signal = new AbortController().signal;
  await warm.warmShaders({}, {signal});
  assert.deepEqual(used, []);
  await warm.warmShaders({}, {signal, retryKey});
  assert.deepEqual(used, [program]);
});

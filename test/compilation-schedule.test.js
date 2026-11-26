import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompilationSchedule} from '../rendering/compilation-schedule.js';
import {fittedPixelRatio, perspectivePointScale} from '../rendering/viewport.js';

test('perspective projection and an aspect-independent pixel budget', () => {
  assert.equal(fittedPixelRatio(100, 400, 2, 40000), 1);
  assert.equal(fittedPixelRatio(400, 100, 2, 40000), 1);
  assert.equal(fittedPixelRatio(20, 30, 1.5), 1.5);
  assert.ok(Math.abs(perspectivePointScale(600, 90) - 300) < 1e-10);
});

test('early builds, scene readiness, disposal and incremental first use', async () => {
  const scene = {}, group = {}, info = {programs: []}, used = [], queued = [];
  const phases = [];
  const start = createCompilationSchedule({
    renderer: {info}, scene,
    beginCompiles(root, warmed) { phases.push(warmed); info.programs.push({root}); },
    putToUse(list) { queued.push(...list); }, useProgram(program) { used.push(program); }
  });
  const early = start.beginWarm();
  info.programs.pop();
  await early;
  assert.deepEqual(queued, []);
  await start.warmShaders(group);
  await start.warmShaders();
  assert.deepEqual(used, info.programs);
  await start.warmShaders(group);
  assert.deepEqual(queued, info.programs.slice(-1));
  start.beginWarm();
  assert.deepEqual(phases, [false, false, false, true]);
});

test('a blocking batch submits attached subtrees once and waits for readiness', async () => {
  const scene = {}, info = {programs: []}, visits = [], visible = [], initialized = [];
  const roots = [true, false, true].map((shown, index) => ({
    parent: index === 0 ? scene : null,
    traverse(visit) { visit(this); },
    traverseVisible(visit) { if (shown) visit(this); }
  }));
  const program = {};
  let finish, calls = 0;
  const schedule = createCompilationSchedule({
    renderer: {info}, scene,
    beginCompiles(root, warmed, blocking) {
      calls++;
      assert.ok(blocking);
      root.traverse(node => visits.push(node));
      root.traverseVisible(node => visible.push(node));
      info.programs.push(program);
      return new Promise(resolve => { finish = resolve; });
    },
    putToUse() { assert.fail('unexpected interactive warmup'); },
    useProgram(p) { initialized.push(p); }
  });
  await schedule.warmShaders([], {blocking: true});
  const done = schedule.warmShaders(roots, {blocking: true});
  assert.deepEqual(initialized, []);
  finish();
  await done;
  assert.equal(calls, 1);
  assert.deepEqual(visits, roots);
  assert.deepEqual(visible, [roots[2]]);
  assert.deepEqual(roots.map(root => root.parent), [scene, null, null]);
  assert.deepEqual(initialized, [program]);
});

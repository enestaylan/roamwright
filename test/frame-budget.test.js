import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameBudget } from 'roamwright/runtime/frame-budget.js';
import { createGroundLookahead } from 'roamwright/motion/ground-lookahead.js';
import { joinParts } from 'roamwright/geometry/part-ranges.js';

test('separate producers share one allowance and a deadline, including failed work', () => {
  let clock = 0;
  const budget = createFrameBudget({ frameMs: 16, reserveMs: 7, workMs: 3, now: () => clock });
  const owner = {
    work: budget.task(function (cost) {
      assert.equal(this, owner);
      clock += cost;
    }),
  };
  const fails = budget.task(() => {
    clock++;
    throw Error('failed');
  });
  budget.begin(0);
  assert.equal(owner.work(2), true);
  assert.throws(fails, /failed/);
  assert.equal(owner.work(1), false);
  clock = 16;
  budget.begin(clock);
  clock += 10;
  assert.equal(owner.work(1), false);
});

test('a missed refresh reduces the allowance, then spare frames restore it', () => {
  let clock = 0;
  const budget = createFrameBudget({ frameMs: 16, workMs: 4, now: () => clock });
  const work = budget.task(() => clock++);
  function count(start) {
    clock = start;
    budget.begin(start);
    let n = 0;
    while (work()) n++;
    return n;
  }
  assert.deepEqual([0, 32, 48, 64, 80, 96].map(count), [4, 2, 3, 3, 4, 4]);
});

test('overdue work advances at most one unit on an exhausted frame', () => {
  let clock = 0,
    done = 0;
  const budget = createFrameBudget({ frameMs: 16, reserveMs: 6, maxWaitMs: 30, now: () => clock });
  const a = budget.task(() => done++),
    b = budget.task(() => done++);
  for (const t of [0, 16, 32, 48]) {
    budget.begin(t);
    clock = t + 12;
    a();
    b();
  }
  assert.equal(done, 2);
});

test('lookahead resets after gaps and teleports and caps extrapolation', () => {
  const predict = createGroundLookahead({ seconds: 3, maxDistance: 10, smoothing: 2, jumpDistance: 45, maxGap: 0.5 });
  const point = predict(0, 0, 0);
  assert.equal(point.jumped, true);
  assert.equal(predict(10, 0, 0.25), point);
  assert.equal(point.x, 20);
  assert.equal(predict(12, 0, 2).x, 12);
  assert.equal(predict(100, 0, 2.1).jumped, true);
});

test('ordered geometry ranges keep position and padded attribute bytes', () => {
  const piece = n => ({ position: new Float32Array(3 * n).map((_, i) => i), color: new Uint8Array(4 * n).map((_, i) => i + 10) });
  const a = piece(2),
    b = piece(1);
  const result = joinParts([
    [a, 3, 6],
    [b, 0, 3],
    [a, 0, 3],
  ]);
  assert.deepEqual([...result.position], [3, 4, 5, 0, 1, 2, 0, 1, 2]);
  assert.deepEqual([...result.color], [14, 15, 16, 17, 10, 11, 12, 13, 10, 11, 12, 13]);
  assert.equal(joinParts([[piece(0), 0, 0]]).color.length, 0);
});

test('exact indexing round-trips triangle order and all attribute bytes, including seams', async () => {
  const { indexParts } = await import('roamwright/geometry/index-parts.js');
  const raw = {
    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]),
    color: new Uint8Array([1, 2, 3, 2, 2, 3, 3, 2, 3, 1, 2, 3, 9, 2, 3, 2, 2, 3]),
    tag: new Float32Array([0, -0, 1, 0, 1, -0]),
  };
  const packed = indexParts(raw);
  assert.deepEqual([...packed.index], [0, 1, 2, 0, 3, 1]);
  for (const [name, data] of Object.entries(raw)) {
    const stride = data.length / packed.index.length;
    const rebuilt = new data.constructor(data.length);
    packed.index.forEach((id, i) => rebuilt.set(packed[name].subarray(id * stride, (id + 1) * stride), i * stride));
    assert.deepEqual(new Uint8Array(rebuilt.buffer), new Uint8Array(data.buffer));
  }
  assert.equal(indexParts(packed), packed);
});

test('instance visibility preserves every transform and tint across repeated swaps', async () => {
  const T = await import('three');
  const { createInstanceVisibility } = await import('roamwright/geometry/instance-visibility.js');
  const { partitionInstances } = await import('roamwright/geometry/instances.js');
  const mesh = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 4);
  for (let i = 0; i < 4; i++) {
    mesh.setMatrixAt(i, new T.Matrix4().makeTranslation(i * 10, 0, 0));
    mesh.setColorAt(i, new T.Color(i, 0, 0));
  }
  const cells = partitionInstances({ matrices: mesh.instanceMatrix.array, colours: mesh.instanceColor.array }, 20);
  assert.deepEqual(
    cells.map(c => Array.from(c.colours).filter((_, i) => i % 3 === 0)),
    [
      [0, 1],
      [2, 3],
    ],
  );
  const show = createInstanceVisibility(mesh);
  const expected = new Set([0, 1, 2, 3]);
  for (const [id, v] of [
    [0, false],
    [2, false],
    [0, false],
    [1, false],
    [3, false],
    [2, true],
    [0, true],
    [3, true],
    [1, true],
  ]) {
    show(id, v);
    if (v) expected.add(id);
    else expected.delete(id);
    const found = new Set();
    for (let i = 0; i < mesh.count; i++) {
      const pose = mesh.instanceMatrix.array[i * 16 + 12] / 10;
      assert.equal(mesh.instanceColor.array[i * 3], pose);
      found.add(pose);
    }
    assert.deepEqual(found, expected);
  }
});

test('static foliage indexes matching corners with unchanged normals, tints and leaf flags', async () => {
  const T = await import('three');
  const { addShape, partsGeometry, shapeParts } = await import('roamwright/geometry/foliage.js');
  const parts = shapeParts();
  const plane = new T.PlaneGeometry(1, 2);
  const pose = new T.Matrix4().makeScale(4, 3, 2).setPosition(5, 6, 7);
  addShape(
    parts,
    plane,
    pose,
    (x, y, z, out) => {
      out[0] = x;
      out[1] = y;
      out[2] = z;
    },
    1,
  );
  const model = partsGeometry(parts);
  assert.equal(model.attributes.position.count, 4);
  const expanded = model.toNonIndexed();
  for (const [name, key] of [
    ['position', 'p'],
    ['normal', 'n'],
    ['color', 'c'],
    ['aLeaf', 'l'],
  ])
    assert.deepEqual(expanded.attributes[name].array, new Float32Array(parts[key]));
  assert.deepEqual(joinParts([]), {});
});

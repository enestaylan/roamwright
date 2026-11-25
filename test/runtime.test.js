import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { createFirstUse } from '../runtime/first-use.js';
import { createHandOver } from '../runtime/hand-over.js';
import { createPool } from '../runtime/pool.js';
import { createVisibilityQueries } from '../runtime/seen.js';
import { attachWorker } from '../runtime/worker.js';

function endpoint(t, jobs, loaders = {}) {
  const { port1, port2 } = new MessageChannel();
  const close = () => {
    port1.close();
    port2.close();
  };
  t.after(close);
  port1.terminate = close;
  attachWorker({ port: port2, jobs, loaders });
  return port1;
}

test('pool routes immediate work by cost and sends a preparation before its dependents', async t => {
  const events = [[], []];
  const workers = events.map((calls, index) =>
    endpoint(t, {
      configure(value) {
        calls.push(value);
      },
      draw(value) {
        calls.push(value);
        return index;
      },
    }),
  );
  const pool = createPool({ startWorkers: () => workers, idleMs: 1 });
  pool.prepare('configure', 'settings', 2);
  const heavy = pool.run('draw', 'large', [], 'configure', 20);
  const light = pool.run('draw', 'small', [], 'configure', 1);
  assert.deepEqual(await Promise.all([heavy, light]), [0, 1]);
  assert.deepEqual(events, [
    ['settings', 'large'],
    ['settings', 'small'],
  ]);
  await pool.runOnEach('draw', 'finish');
  assert.deepEqual(
    events.map(calls => calls.at(-1)),
    ['finish', 'finish'],
  );
});

test('a failed preparation rejects queued dependents and retries on the same worker', async t => {
  let tries = 0;
  const worker = endpoint(t, {
    setup() {
      if (!tries++) throw new Error('setup failed');
    },
    result: value => value,
  });
  const messages = [];
  const pool = createPool({ startWorkers: () => [worker], idleMs: 1, warn: message => messages.push(message) });
  pool.prepare('setup', null);
  assert.equal(
    await pool.runOrHere(
      'result',
      () => 5,
      () => 9,
      1,
      'setup',
    ),
    9,
  );
  assert.equal(await pool.run('result', 7, [], 'setup'), 7);
  assert.equal(tries, 2);
  assert.equal(messages.length, 2);
});

test('lazy worker modules load once in FIFO order and transfer shared backing stores once', async t => {
  let loads = 0;
  const order = [];
  let bytes;
  const worker = endpoint(
    t,
    {},
    {
      views: async () => {
        loads++;
        return {
          jobs: {
            async views() {
              await Promise.resolve();
              order.push('views');
              bytes = new Uint8Array([42, 7]);
              return { whole: bytes, tail: bytes.subarray(1), backing: bytes.buffer };
            },
            next() {
              order.push('next');
              return null;
            },
          },
        };
      },
    },
  );
  const pool = createPool({ startWorkers: () => [worker], idleMs: 1, warn: () => {} });
  pool.ready('views');
  const [result] = await Promise.all([pool.run('views'), pool.run('next')]);
  assert.deepEqual(order, ['views', 'next']);
  assert.equal(loads, 1);
  assert.deepEqual([...result.tail], [7]);
  assert.equal(result.tail.buffer, result.whole.buffer);
  assert.equal(result.backing, result.whole.buffer);
  assert.equal(bytes.byteLength, 0);
  await assert.rejects(pool.run('missing'), /Unknown job/);
  assert.equal(await pool.run('next'), null);
});

test('an unavailable worker factory uses the caller fallback', async () => {
  const pool = createPool({
    startWorkers() {
      throw new Error('disabled');
    },
    warn() {},
  });
  assert.equal(
    await pool.runOrHere(
      'draw',
      () => null,
      () => 10,
    ),
    10,
  );
  assert.equal(pool.pooled(), false);
  assert.equal(pool.poolSize(), 0);
});

test('upload pacing yields at the byte budget and restores mesh state on the first draw', async () => {
  let paints = 0;
  const upload = createHandOver({
    painted: async () => {
      paints++;
    },
    frameShare: () => 8,
  });
  function* steps() {
    yield 3;
    yield 5;
    yield 1;
    return 12;
  }
  assert.equal(await upload.paced(steps()), 12);
  assert.equal(paints, 1);
  assert.equal(upload.drain(steps()), 12);
  const geometry = {
    attributes: { position: { array: new Float32Array(6), onUploadCallback() {} } },
    drawRange: { start: 1, count: 6 },
    setDrawRange(start, count) {
      this.drawRange = { start, count };
    },
  };
  const mesh = { isMesh: true, geometry, visible: false, frustumCulled: true };
  await upload.handToCard([{ traverse: callback => callback(mesh) }]);
  assert.deepEqual(geometry.drawRange, { start: 0, count: 0 });
  assert.equal(mesh.visible, true);
  upload.frameDrawn();
  assert.deepEqual(geometry.drawRange, { start: 1, count: 6 });
  assert.equal(mesh.visible, false);
  assert.equal(mesh.frustumCulled, true);
  assert.equal(upload.anyFrameDrawn(), true);
  assert.equal(upload.heldBytes(geometry), 24);
});

test('pending programs are warmed one per frame with the renderer debug setting restored', async () => {
  const warmed = [];
  const renderer = { debug: { checkShaderErrors: true }, getContext: () => ({ getProgramParameter: () => true }) };
  const queue = createFirstUse({ renderer, now: () => 0, waitMs: 1 });
  const programs = [1, 2].map(id => ({
    program: {},
    getUniforms() {
      assert.equal(renderer.debug.checkShaderErrors, false);
      warmed.push(id);
    },
  }));
  queue.useAtFrameStart();
  const pending = queue.putToUse(programs);
  queue.useAtFrameStart();
  assert.deepEqual(warmed, [1]);
  queue.useAtFrameStart();
  await pending;
  assert.deepEqual(warmed, [1, 2]);
  assert.equal(renderer.debug.checkShaderErrors, true);
});

test('an occlusion answer hides the mesh only while it remains fresh', () => {
  let frame = 0;
  let available = false;
  let queries = 0;
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    createQuery: () => ({}),
    beginQuery() {
      queries++;
    },
    endQuery() {},
    getQueryParameter: (_, key) => (key === 1 ? available : 0),
  };
  const camera = {},
    mesh = {};
  const visibility = createVisibilityQueries({ renderer: { getContext: () => gl }, camera, frame: () => frame });
  const watch = visibility.watchSeen(mesh);
  mesh.onBeforeRender(null, null, {});
  mesh.onAfterRender();
  assert.equal(queries, 0);
  mesh.onBeforeRender(null, null, camera);
  mesh.onAfterRender();
  assert.equal(visibility.hidden(watch), false);
  available = true;
  assert.equal(visibility.hidden(watch), true);
  frame = 5;
  assert.equal(visibility.hidden(watch), false);
});

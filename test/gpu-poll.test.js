import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTiming } from 'roamwright/runtime/gpu-timing.js';

test('GPU fence polling yields time to other tasks and reports failed fences', async t => {
  // Run queued tasks without keeping a browser port alive in the Node test runner.
  t.mock.method(
    globalThis,
    'MessageChannel',
    class {
      port1 = {};
      port2 = { postMessage: () => setImmediate(() => this.port1.onmessage()) };
    },
  );
  let status,
    polls = 0,
    deleted = 0;
  const gl = {
    TIMEOUT_EXPIRED: 1,
    WAIT_FAILED: 2,
    fenceSync: () => ({}),
    flush() {},
    deleteSync: () => deleted++,
    clientWaitSync() {
      polls++;
      return status;
    },
  };
  const timer = createGpuTiming({ getContext: () => gl });
  status = gl.TIMEOUT_EXPIRED;
  const done = timer.cardDone();
  setTimeout(() => {
    status = 0;
  }, 20);
  const result = await done;
  assert.equal(result.gaveUp, false);
  assert.equal(result.prompt, false);
  assert.ok(polls < 60);
  status = gl.WAIT_FAILED;
  assert.equal((await timer.cardDone()).gaveUp, true);
  assert.equal(deleted, 2);
});

/**
 * Handle named jobs on the worker side of the Roamwright pool protocol.
 * @module
 */

// Transfer backing stores once, including when several views share a buffer.
function transferList(result) {
  const buffers = new Set();
  const visited = new Set();
  function visit(value) {
    if (value === null || typeof value !== 'object') return;
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
    } else if (value instanceof ArrayBuffer) {
      buffers.add(value);
    } else if (!visited.has(value)) {
      visited.add(value);
      for (const child of Object.values(value)) visit(child);
    }
  }
  visit(result);
  return [...buffers];
}

/**
 * Bind a pool worker to a message port. Jobs receive the input carried in the
 * request. A loader returns a module exposing a jobs object, which may supply
 * several handlers at once. Requests, including asynchronous work, finish FIFO.
 * ArrayBuffers in a successful result transfer to the caller. A handler that
 * needs its own copy must keep a separate buffer before returning the result.
 */
export function attachWorker({ port, jobs = {}, loaders = {} }) {
  const handlers = new Map(Object.entries(jobs));
  const modules = new Map(Object.entries(loaders));
  async function load(name) {
    if (handlers.has(name)) return;
    const fetchModule = modules.get(name);
    if (!fetchModule) throw new Error('Unknown job: ' + name);
    const module = await fetchModule();
    for (const [job, handler] of Object.entries(module.jobs)) handlers.set(job, handler);
    if (!handlers.has(name)) throw new Error('Module did not provide job: ' + name);
  }
  handlers.set('load', async name => {
    await load(name);
    return null;
  });
  async function answer({ job, input }) {
    try {
      await load(job);
      const result = await handlers.get(job)(input);
      port.postMessage({ result }, transferList(result));
    } catch (error) {
      port.postMessage({ error: String(error?.message ?? error) || 'Job failed' });
    }
  }
  let previous = Promise.resolve();
  port.onmessage = ({ data }) => {
    previous = previous.then(() => answer(data));
  };
}

/**
 * Initialize a compiled Three.js program before other draws reach the driver.
 * Call useAtFrameStart() at the beginning of each frame. When rendering stops,
 * a timeout drains requests that would otherwise never resolve.
 */
export function createFirstUse({ renderer, waitMs = 250, now = () => performance.now() }) {
  const initialized = new WeakSet();
  const waiting = [];
  let frameBegan = -Infinity;

  function useProgram(program) {
    if (!program.program || initialized.has(program.program)) return;
    const gl = renderer.getContext();
    const previous = renderer.debug.checkShaderErrors;
    try {
      renderer.debug.checkShaderErrors = previous && !gl.getProgramParameter(program.program, gl.LINK_STATUS);
      program.getUniforms();
      initialized.add(program.program);
    } finally {
      renderer.debug.checkShaderErrors = previous;
    }
  }
  function putToUse(programs, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!programs.length) return Promise.resolve();
    if (now() - frameBegan > waitMs) {
      programs.forEach(useProgram);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const request = { remaining: programs.length, finish, fail };
      const timer = setTimeout(drainRequest, waitMs * (programs.length + 1));
      for (const program of programs) waiting.push({ program, request });
      signal?.addEventListener('abort', abort, { once: true });
      function finish() {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve();
      }
      function fail(error) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        for (let i = waiting.length - 1; i >= 0; i--)
          if (waiting[i].request === request) waiting.splice(i, 1);
        reject(error);
      }
      function abort() { fail(signal.reason); }
      function drainRequest() {
        for (let i = 0; i < waiting.length;) {
          if (waiting[i].request === request) useOne(waiting.splice(i, 1)[0]);
          else i++;
        }
      }
    });
  }
  function useOne({ program, request }) {
    try {
      useProgram(program);
      if (--request.remaining === 0) request.finish();
    } catch (error) { request.fail(error); }
  }
  function useAtFrameStart() {
    frameBegan = now();
    if (waiting.length) useOne(waiting.shift());
  }
  return { putToUse, useAtFrameStart, useProgram };
}

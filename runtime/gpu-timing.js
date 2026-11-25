/** Per-renderer WebGL2 fence and timer queries for measuring frame cost. */
export function createGpuTiming(renderer) {
  const NANOSECONDS_IN_MS = 1e6;
  const GIVE_UP_MS = 400; // a fence not passed by then is not waited for (a page in the background, a lost context)

  // Runs a function as the next task, without the four milliseconds a nested setTimeout waits.
  const channel = new MessageChannel(),
    waiting = [];
  channel.port1.onmessage = () => waiting.shift()();
  function nextTask(run) {
    waiting.push(run);
    channel.port2.postMessage(0);
  }
  // Fall back to a synchronous pixel read when a visible context repeatedly times out.
  let blocks = false;
  const _pixel = new Uint8Array(4);
  const cardBlocks = () => blocks;
  // Resolves once the card has drawn everything handed to it before this call, with when that was seen (performance.now()),
  // whether it was already so the first time it was asked (the card was not behind), and whether the wait was given up.
  function cardDone() {
    const gl = renderer.getContext();
    if (blocks) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _pixel);
      return Promise.resolve({ at: performance.now(), prompt: false, gaveUp: false });
    }
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0),
      since = performance.now();
    let asked = 0;
    if (!fence) return Promise.resolve({ at: since, prompt: false, gaveUp: true });
    gl.flush();
    return new Promise(resolve => {
      const ask = () => {
        const at = performance.now(),
          waiting = gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED;
        if (waiting && at - since < GIVE_UP_MS) {
          asked++;
          nextTask(ask);
          return;
        }
        gl.deleteSync(fence);
        if (waiting && !globalThis.document?.hidden) blocks = true; // not passed in all that time on a page that is being shown: fences do not work here
        resolve({ at, prompt: asked === 0, gaveUp: waiting });
      };
      nextTask(ask);
    });
  }

  // How long the card itself works on a frame, measured by the card (a timer query) where the browser offers one: Chrome on
  // a desktop does. timeCard() is called before a frame is handed over and returns the function to call after it, or null
  // when no measurement can begin (no such query here, or the last one has not been answered yet); cardWork() gives the last
  // answer in milliseconds, or null if there has been none.
  let timer; // the extension, once asked for (null where there is none)
  let asked = null, // the query waiting for its answer
    work = null;
  function timeCard() {
    const gl = renderer.getContext();
    if (timer === undefined) timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!timer) return null;
    if (asked) {
      if (!gl.getQueryParameter(asked, gl.QUERY_RESULT_AVAILABLE)) return null;
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) work = gl.getQueryParameter(asked, gl.QUERY_RESULT) / NANOSECONDS_IN_MS;
      gl.deleteQuery(asked);
      asked = null;
    }
    const query = gl.createQuery();
    if (!query) return null;
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    return () => {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      asked = query;
    };
  }
  const cardWork = () => work;
  return { cardBlocks, cardDone, cardWork, timeCard };
}

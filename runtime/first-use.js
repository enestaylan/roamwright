/**
 * Initialize a compiled Three.js program before other draws reach the driver.
 * Call useAtFrameStart() at the beginning of each frame. When rendering stops,
 * a timeout drains requests that would otherwise never resolve.
 */
export function createFirstUse({ renderer, waitMs = 250, now = () => performance.now() }) {
  const initialized = new WeakSet();
  const waiting = [];
  const asked = [];
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
  function settle() {
    for (let i = asked.length - 1; i >= 0; i--) {
      const [programs, resolve] = asked[i];
      if (programs.some(p => waiting.includes(p))) continue;
      asked.splice(i, 1);
      resolve();
    }
  }
  function putToUse(programs) {
    if (!programs.length) return Promise.resolve();
    if (now() - frameBegan > waitMs) {
      programs.forEach(useProgram);
      return Promise.resolve();
    }
    waiting.push(...programs);
    return new Promise(resolve => {
      asked.push([programs, resolve]);
      setTimeout(
        () => {
          for (const p of programs) {
            const at = waiting.indexOf(p);
            if (at < 0) continue;
            waiting.splice(at, 1);
            useProgram(p);
          }
          settle();
        },
        waitMs * (programs.length + 1),
      );
    });
  }
  function useAtFrameStart() {
    frameBegan = now();
    if (!waiting.length) return;
    useProgram(waiting.shift());
    settle();
  }
  return { putToUse, useAtFrameStart, useProgram };
}

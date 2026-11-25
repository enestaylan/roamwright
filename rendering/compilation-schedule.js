// Coordinate early, whole-scene and incremental program warmup. The application supplies its pass
// graph and decides how newly linked programs enter the renderer's first-use queue.
export function createCompilationSchedule({renderer, scene, beginCompiles, putToUse, useProgram, timeoutMs = 20000, onError = () => {}}) {
  let warmed = false;
  const programs = () => renderer.info.programs;
  const addedSince = known => programs().filter(program => !known.has(program));
  function beginWarm() {
    if (warmed) return;
    const known = new Set(programs());
    try {
      const done = beginCompiles(scene, warmed);
      const added = addedSince(known);
      return Promise.resolve(done).then(() => putToUse(added.filter(p => programs().includes(p)))).catch(onError);
    } catch (error) { onError(error); }
  }
  async function warmShaders(root = scene) {
    const known = new Set(programs());
    let timer;
    try {
      const done = beginCompiles(root, warmed);
      if (root !== scene && !warmed) {
        Promise.resolve(done).catch(onError);
        return;
      }
      await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
      if (root === scene) {
        for (const program of programs()) useProgram(program);
        warmed = true;
      } else await putToUse(addedSince(known));
    } catch (error) { onError(error); }
    finally { clearTimeout(timer); }
  }
  return {beginWarm, warmShaders};
}

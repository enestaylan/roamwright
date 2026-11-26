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
  // Disjoint subtrees of one scene can share a pass without being reparented. A blocking load
  // may submit them together and initialize the programs before its first draw.
  async function warmShaders(root = scene, {blocking = false} = {}) {
    if (Array.isArray(root)) {
      const roots = root;
      if (!roots.length) return;
      root = {
        traverse(visit) { for (const tree of roots) tree.traverse(visit); },
        traverseVisible(visit) {
          // The target scene already contributes its visible lights. Only detached roots
          // bring additional lights to Three's compile pass.
          for (const tree of roots) {
            let parent = tree;
            while (parent && parent !== scene) parent = parent.parent;
            if (!parent) tree.traverseVisible(visit);
          }
        }
      };
    }
    const known = new Set(programs());
    let timer;
    try {
      const done = beginCompiles(root, warmed, blocking);
      if (root !== scene && !warmed && !blocking) {
        Promise.resolve(done).catch(onError);
        return;
      }
      await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
      if (root === scene) {
        for (const program of programs()) useProgram(program);
        warmed = true;
      } else if (blocking) {
        for (const program of addedSince(known)) useProgram(program);
      } else await putToUse(addedSince(known));
    } catch (error) { onError(error); }
    finally { clearTimeout(timer); }
  }
  return {beginWarm, warmShaders};
}

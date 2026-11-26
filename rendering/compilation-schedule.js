// Coordinate early, whole-scene and incremental program warmup. The application supplies its pass
// graph and decides how newly linked programs enter the renderer's first-use queue.
export function createCompilationSchedule({renderer, scene, beginCompiles, putToUse, useProgram, timeoutMs = 20000, onError = () => {}}) {
  let warmed = false;
  const interrupted = new WeakMap();
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
  async function warmShaders(root = scene, {blocking = false, signal, retryKey = root} = {}) {
    signal?.throwIfAborted();
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
    const unfinished = signal && interrupted.get(retryKey);
    if (unfinished) for (const p of known) if (unfinished.has(p)) known.delete(p);
    let timer, onAbort;
    const deadline = signal && new AbortController();
    const active = signal && AbortSignal.any([signal, deadline.signal]);
    try {
      const done = beginCompiles(root, warmed, blocking, active);
      if (root !== scene && !warmed && !blocking && !signal) {
        Promise.resolve(done).catch(onError);
        return;
      }
      const limit = new Promise((resolve, reject) => {
        if (!active) {
          timer = setTimeout(resolve, timeoutMs);
          return;
        }
        onAbort = () => reject(active.reason);
        if (active.aborted) { onAbort(); return; }
        active.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => deadline.abort(new Error('Shader preparation timed out')), timeoutMs);
      });
      await Promise.race([done, limit]);
      active?.throwIfAborted();
      if (root === scene) {
        for (const program of programs()) useProgram(program);
        warmed = true;
      } else if (blocking) {
        for (const program of addedSince(known)) useProgram(program);
      } else await putToUse(addedSince(known), active);
      if (unfinished) interrupted.delete(retryKey);
    } catch (error) {
      if (signal) {
        const unclaimed = unfinished || new WeakSet();
        for (const program of addedSince(known)) unclaimed.add(program);
        interrupted.set(retryKey, unclaimed);
        // Other passes in the same preparation may still have an incremental submission queued.
        deadline.abort(error);
        if (signal.aborted) throw signal.reason;
      }
      onError(error);
      if (signal) throw error;
    }
    finally {
      clearTimeout(timer);
      if (onAbort) active.removeEventListener('abort', onAbort);
    }
  }
  return {beginWarm, warmShaders};
}

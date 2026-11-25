/**
 * Test mesh visibility using asynchronous WebGL 2 occlusion queries from the
 * supplied camera. A stale or unavailable answer is treated as visible.
 * watchSeen takes ownership of the mesh's before/after render callbacks.
 */
export function createVisibilityQueries({ renderer, camera, frame, freshFrames = 4, patienceMs = 500, now = () => performance.now() }) {
  function watchSeen(mesh) {
    const gl = renderer.getContext(),
      watch = { query: null, asking: false, waiting: false, seen: true, asked: -Infinity, askedAt: 0 };
    mesh.onBeforeRender = (_renderer, _scene, viewer) => {
      if (viewer !== camera || watch.waiting) return;
      watch.query ??= gl.createQuery();
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, watch.query);
      watch.asking = true;
    };
    mesh.onAfterRender = () => {
      if (!watch.asking) return;
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
      watch.asking = false;
      watch.waiting = true;
      watch.asked = frame();
      watch.askedAt = now();
    };
    return watch;
  }
  function hidden(watch) {
    const gl = renderer.getContext();
    if (watch.waiting && gl.getQueryParameter(watch.query, gl.QUERY_RESULT_AVAILABLE)) {
      watch.seen = gl.getQueryParameter(watch.query, gl.QUERY_RESULT) > 0;
      watch.waiting = false;
    }
    if (watch.seen) return false;
    return watch.waiting ? now() - watch.askedAt < patienceMs : frame() - watch.asked <= freshFrames;
  }
  return { hidden, watchSeen };
}

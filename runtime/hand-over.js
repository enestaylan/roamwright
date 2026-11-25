/**
 * Share an upload budget across temporary zero-range draws and direct buffer
 * writes. Call frameDrawn() after each render. frameShare() returns the current
 * byte budget and painted() resolves after the browser has painted.
 */
export function createHandOver({ painted, frameShare }) {
  let handing = Promise.resolve();
  let handed = 0,
    drawn = 0;
  const beforeFirst = [];
  // Overlapping roots may refer to the same geometry before it has drawn.
  const inHand = new WeakSet();
  function frameDrawn() {
    drawn++;
    handed = 0;
    if (beforeFirst.length) {
      restore(beforeFirst);
      beforeFirst.length = 0;
    }
  }
  const countHanded = bytes => {
    handed += bytes;
  };
  const frameFull = () => handed >= frameShare();
  // A browser can paint without rendering a scene while loading.
  async function nextShare() {
    const was = drawn;
    await painted();
    if (drawn === was) handed = 0;
  }

  const heldBytes = geometry => Object.values(geometry.attributes).reduce((sum, a) => sum + (a.array?.byteLength ?? 0), 0);
  const letsGo = geometry => Object.values(geometry.attributes).some(a => Object.hasOwn(a, 'onUploadCallback'));

  function handToCard(roots) {
    const found = new Map();
    for (const root of roots)
      root.traverse(o => {
        if (o.isMesh && !o.isSkinnedMesh && !inHand.has(o.geometry) && heldBytes(o.geometry) && letsGo(o.geometry))
          found.set(o.geometry, [...(found.get(o.geometry) ?? []), o]);
      });
    const turn = handing.then(() => handOver(found));
    handing = turn.catch(() => {});
    return turn;
  }
  async function handOver(found) {
    let batch = [];
    const flush = async () => {
      try {
        await nextShare();
      } finally {
        restore(batch);
        batch = [];
      }
    };
    for (const [geometry, meshes] of found) {
      if (inHand.has(geometry)) continue;
      inHand.add(geometry);
      const range = { ...geometry.drawRange },
        was = meshes.map(m => ({ visible: m.visible, frustumCulled: m.frustumCulled }));
      geometry.setDrawRange(0, 0);
      for (const m of meshes) {
        m.visible = true;
        m.frustumCulled = false;
      }
      // The first render uploads everything queued before the render loop started.
      if (!drawn) {
        beforeFirst.push([geometry, meshes, range, was]);
        continue;
      }
      countHanded(heldBytes(geometry));
      batch.push([geometry, meshes, range, was]);
      if (frameFull()) await flush();
    }
    if (batch.length) await flush();
  }
  function restore(handedOver) {
    for (const [geometry, meshes, range, was] of handedOver) {
      geometry.setDrawRange(range.start, range.count);
      inHand.delete(geometry);
      meshes.forEach((m, i) => Object.assign(m, was[i]));
    }
  }

  async function paced(steps) {
    let step;
    while (!(step = steps.next()).done) {
      countHanded(step.value);
      if (frameFull()) await nextShare();
    }
    return step.value;
  }
  function drain(steps) {
    let step;
    do step = steps.next();
    while (!step.done);
    return step.value;
  }

  const anyFrameDrawn = () => drawn > 0;
  return { anyFrameDrawn, countHanded, drain, frameDrawn, frameFull, handToCard, heldBytes, paced };
}

import * as THREE from 'three';

export function createPlanarReflection({ camera, renderer, scene, drawnSize, waterCells, cellSize, scale = 0.5, minSize = 256, hiddenInterval = 4 }) {
  const mirror = {
    rt: null,
    cam: new THREE.PerspectiveCamera(),
    on: false,
    plane: new THREE.Plane(),
    clip: new THREE.Vector4(),
    q: new THREE.Vector4(),
    frustum: new THREE.Frustum(),
    n: new THREE.Vector3(0, 1, 0),
    o: new THREE.Vector3(),
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    rot: new THREE.Matrix4(),
    m: new THREE.Matrix4(),
  };
  const WAVE_X = 0.1, // the waves bend the reflection sideways and up or down by up to this much of the picture's half-size
    WAVE_Y = 0.16,
    IN_FRONT = 0.05, // a corner nearer the mirror camera's plane than this is cut off
    NOTHING = new THREE.Color(-1, -1, -1), // what the mirror holds outside the part drawn: the water takes the plain sky there
    _colour = new THREE.Color(),
    _corner = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()],
    _cut = new THREE.Vector4(),
    part = { x0: 0, x1: 0, y0: 0, y1: 0 }; // the part of the picture where water shows, from -1 to 1 each way

  function findWaterPart(view, level) {
    const M = mirror,
      cells = (M.cells ??= waterCells());
    let x0 = 1,
      x1 = -1,
      y0 = 1,
      y1 = -1;
    for (let c = 0; c < cells.length; c += 2) {
      let left = true, // is the whole cell off one side of the picture?
        right = true,
        below = true,
        above = true,
        ax = 1, // the cell's own box
        bx = -1,
        ay = 1,
        by = -1;
      const take = p => {
        const x = p.x / p.w,
          y = p.y / p.w;
        left &&= x < -1;
        right &&= x > 1;
        below &&= y < -1;
        above &&= y > 1;
        ax = Math.min(ax, x);
        bx = Math.max(bx, x);
        ay = Math.min(ay, y);
        by = Math.max(by, y);
      };
      for (let k = 0; k < 4; k++)
        _corner[k].set(cells[c] + (k === 1 || k === 2 ? cellSize : 0), level, cells[c + 1] + (k > 1 ? cellSize : 0), 1).applyMatrix4(view);
      for (let k = 0; k < 4; k++) {
        const a = _corner[k],
          b = _corner[(k + 1) % 4];
        if (a.w > IN_FRONT) take(a);
        if (a.w > IN_FRONT !== b.w > IN_FRONT) take(_cut.lerpVectors(a, b, (IN_FRONT - a.w) / (b.w - a.w))); // where the edge passes the camera's plane
      }
      if (bx < ax || left || right || below || above) continue;
      x0 = Math.min(x0, ax);
      x1 = Math.max(x1, bx);
      y0 = Math.min(y0, ay);
      y1 = Math.max(y1, by);
    }
    part.x0 = Math.max(-1, x0 - WAVE_X);
    part.x1 = Math.min(1, x1 + WAVE_X);
    part.y0 = Math.max(-1, y0 - WAVE_Y);
    part.y1 = Math.min(1, y1 + WAVE_Y);
    return x1 > x0 && y1 > y0;
  }
  // Fits the mirror's camera and target to `part`: whole pixels of the target, and a projection that fills just those, so each
  // reflected thing lands on the pixel it would have in the whole picture.
  function fitToPart(projection, target) {
    const w = target.width,
      h = target.height,
      px0 = Math.floor(((part.x0 + 1) / 2) * w),
      px1 = Math.ceil(((part.x1 + 1) / 2) * w),
      py0 = Math.floor(((part.y0 + 1) / 2) * h),
      py1 = Math.ceil(((part.y1 + 1) / 2) * h),
      x0 = (2 * px0) / w - 1,
      x1 = (2 * px1) / w - 1,
      y0 = (2 * py0) / h - 1,
      y1 = (2 * py1) / h - 1,
      e = projection.elements;
    for (let col = 0; col < 16; col += 4) {
      e[col] = (2 * e[col] - (x0 + x1) * e[col + 3]) / (x1 - x0);
      e[col + 1] = (2 * e[col + 1] - (y0 + y1) * e[col + 3]) / (y1 - y0);
    }
    target.viewport.set(px0, py0, px1 - px0, py1 - py0);
    target.scissor.set(px0, py0, px1 - px0, py1 - py0);
  }
  function sizeMirror() {
    // half the size the world is drawn at each way: where the quality fit draws it smaller and upscales it, the mirror shrinks with it
    const [w, h] = drawnSize();
    if (mirror.rt) mirror.rt.setSize(Math.max(minSize, Math.round(w * scale)), Math.max(minSize, Math.round(h * scale)));
  }
  function renderMirror(u, wl, k, unseen, frame) {
    const M = mirror, cp = camera.position;
    if (M.off) k = 0; // debug switch, for measuring what the mirror costs
    u.uReflOn.value = k;
    M.on = k > 0.01;
    if (!M.on || (unseen && M.rt && frame % hiddenInterval)) return;
    if (!M.rt) {
      M.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
      u.uRefl.value = M.rt.texture;
      sizeMirror();
    }
    const c = M.cam,
      o = M.o.set(0, wl, 0);
    M.a.subVectors(o, cp).reflect(M.n).negate().add(o);
    c.position.copy(M.a);
    M.rot.extractRotation(camera.matrixWorld);
    M.b.set(0, 0, -1).applyMatrix4(M.rot).add(cp);
    M.a.subVectors(o, M.b).reflect(M.n).negate().add(o);
    c.up.set(0, 1, 0).applyMatrix4(M.rot).reflect(M.n);
    c.lookAt(M.a);
    c.near = camera.near;
    c.far = camera.far;
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    u.uReflM.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(c.projectionMatrix)
      .multiply(c.matrixWorldInverse);
    const whole = !findWaterPart(M.m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse), wl); // no cell found where water was seen: draw it all
    // tilt the near plane onto the water, so nothing under the surface gets into the mirror
    M.plane.setFromNormalAndCoplanarPoint(M.n, M.o.set(0, wl - 0.05, 0)).applyMatrix4(c.matrixWorldInverse);
    const cl = M.clip.set(M.plane.normal.x, M.plane.normal.y, M.plane.normal.z, M.plane.constant),
      pe = c.projectionMatrix.elements,
      q = M.q;
    q.x = (Math.sign(cl.x) + pe[8]) / pe[0];
    q.y = (Math.sign(cl.y) + pe[9]) / pe[5];
    q.z = -1;
    q.w = (1 + pe[10]) / pe[14];
    cl.multiplyScalar(2 / cl.dot(q));
    pe[2] = cl.x;
    pe[6] = cl.y;
    pe[10] = cl.z + 1;
    pe[14] = cl.w;
    const su = renderer.shadowMap.autoUpdate,
      alpha = renderer.getClearAlpha();
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    renderer.getClearColor(_colour);
    renderer.shadowMap.autoUpdate = false;
    try {
      M.rt.scissorTest = false;
      M.rt.viewport.set(0, 0, M.rt.width, M.rt.height);
      renderer.setRenderTarget(M.rt);
      renderer.setClearColor(NOTHING, 1);
      renderer.clear();
      renderer.setClearColor(_colour, alpha);
      if (!whole) {
        fitToPart(c.projectionMatrix, M.rt);
        M.rt.scissorTest = true;
        renderer.setRenderTarget(M.rt);
      }
      renderer.render(scene, c);
    } finally {
      renderer.setClearColor(_colour, alpha);
      renderer.setRenderTarget(previous, face, mip);
      renderer.shadowMap.autoUpdate = su;
    }
  }
  function dispose() {
    mirror.rt?.dispose();
    mirror.rt = mirror.cells = null;
    mirror.on = false;
  }
  return { mirror, sizeMirror, renderMirror, dispose };
}

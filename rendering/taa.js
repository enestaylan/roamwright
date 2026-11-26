import * as THREE from 'three';

// ════════════════════════════════════════════════════════════════════════
//  Temporal anti-aliasing: the lens is moved by a fraction of a pixel each frame (eight points of the Halton 2, 3 sequence),
//  so that over a few frames every pixel sees its whole span, and the final pass keeps a running picture of what it saw:
//  last frame's picture, carried to where each pixel's point now stands (by the scene's depth and the lens's own motion),
//  takes a sixteenth of this frame. What last frame's picture holds that this frame's pixel and the eight round it do not (a person who
//  walked on, smoke that drifted, a place first uncovered) is clipped back to the spread of that neighbourhood, so nothing
//  leaves a trail. Grass blades, leaf edges, roof tiles, railings and glints that crawled and flickered as the lens moved
//  settle. Only the scene is drawn with the lens moved: the names drawn after it, the sky's mask and anything worked out
//  from the lens between frames see it where it stands. The running picture is light before tone mapping, exposed and
//  squashed into 0 to 1 by its brightest channel (SQUASH), so a blinding lamp weighs no more than white and cannot
//  flicker through the clip; the present pass (post-shaders.js) undoes that and tone-maps it.
// ════════════════════════════════════════════════════════════════════════
const JITTER_POINTS = 8, // the Halton points the lens steps through, then again
  KEEP = 0.06, //         the share of this frame in the running picture while the picture stands still,
  KEEP_MOVING = 0.2, //   and at most, while it slides under the lens (KEEP_SLIDE pixels a frame or more): less blur in motion
  KEEP_SLIDE = 8,
  // how many deviations of the neighbourhood the running picture may stray from its mean: in a still picture wide, or each
  // step of the lens clips it anew and every edge flickers; in a sliding one narrow, or what passed leaves a trail
  CLIP_STILL = 2.0,
  CLIP = 1.0,
  JUMP = 40, //           metres the lens moves in one frame that start the picture afresh (a jump to a place; a scene's cut says so itself)
  STALE = 1000; //        milliseconds between two frames that start it afresh (a page that was hidden, a long pause)

const halton = (i, base) => {
  let digitWeight = 1,
    sequenceValue = 0;
  for (; i > 0; i = Math.floor(i / base)) {
    digitWeight /= base;
    sequenceValue += digitWeight * (i % base);
  }
  return sequenceValue;
};
// The lens's offsets, in pixels from the pixel's centre.
const JITTER = Array.from({ length: JITTER_POINTS }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export function createTemporalAA(camera) {
  // The uniforms the final pass reads: last frame's picture, the matrix that carries a point of this frame's picture to where it
  // stood in the last (both without the offset), this frame's offset in clip space, and whether to start afresh.
  const taaUniforms = {
    tHistory: { value: null },
    uReproj: { value: new THREE.Matrix4() },
    uJit: { value: new THREE.Vector2() },
    uFresh: { value: 1 },
  };
  const taa = { history: [], flip: 0, fresh: true, last: 0, index: 0, saved: [0, 0] };
  const viewProj = new THREE.Matrix4(),
    lastViewProj = new THREE.Matrix4(),
    lastLens = new THREE.Vector3();

  // The two running pictures (read one, write the other), in half floats. Not the scene target's packed floats: with 5 or 6 bits of
  // mantissa a step of that store is 1.5 to 3 percent of the light, a sixteenth of a difference under about eight steps rounds back to
  // what was there, and the running picture stuck a step or two off the frame: in a moving view the sky behind birds kept faint lines
  // along its bands. A half float's step is a thousandth. A card draws into half floats only with alpha (RGB16F cannot be drawn
  // into), so each is 8 bytes a pixel.
  function makeHistory() {
    taa.history = [0, 1].map(
      () => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false }),
    );
    taa.fresh = true;
  }
  function disposeHistory() {
    for (const t of taa.history) t.dispose();
    taa.history = [];
  }
  function sizeHistory(width, height) {
    for (const t of taa.history) t.setSize(width, height);
    taa.fresh = true;
  }
  // The running picture starts afresh on the next frame: a cut, a crossing, a new size.
  function dropHistory() {
    taa.fresh = true;
  }
  // The target this frame's running picture is written into; the last frame's is handed to the final pass.
  function historyInto() {
    taaUniforms.tHistory.value = taa.history[taa.flip].texture;
    taa.flip = 1 - taa.flip;
    return taa.history[taa.flip];
  }
  const historyNow = () => taa.history[taa.flip];

  // Moves the lens by this frame's offset for a viewport of the given width and height in pixels, after noting how the lens moved since the last frame.
  function jitterLens(width, height) {
    const now = performance.now(),
      projectionMatrix = camera.projectionMatrix,
      elements = projectionMatrix.elements;
    if (now - taa.last > STALE || camera.position.distanceToSquared(lastLens) > JUMP * JUMP) taa.fresh = true;
    taa.last = now;
    lastLens.copy(camera.position);
    viewProj.multiplyMatrices(projectionMatrix, camera.matrixWorldInverse);
    taaUniforms.uReproj.value.copy(viewProj).invert().premultiply(lastViewProj);
    lastViewProj.copy(viewProj);
    taaUniforms.uFresh.value = taa.fresh ? 1 : 0;
    taa.fresh = false;
    const point = JITTER[taa.index++ % JITTER_POINTS], // read by index: no iterator made in a frame
      dx = (2 * point[0]) / width,
      dy = (2 * point[1]) / height;
    taaUniforms.uJit.value.set(dx, dy);
    taa.saved[0] = elements[8];
    taa.saved[1] = elements[9];
    elements[8] -= dx; // a point's clip x gains -dx times its view depth, which is dx once divided by w = -depth
    elements[9] -= dy;
    camera.projectionMatrixInverse.copy(projectionMatrix).invert();
  }
  // Puts the lens back where it stands, for everything drawn after the scene.
  function steadyLens() {
    const elements = camera.projectionMatrix.elements;
    elements[8] = taa.saved[0];
    elements[9] = taa.saved[1];
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  // The running pictures while they exist, for the reckoning of memory.
  const taaTargets = () => taa.history;

  return {
    disposeHistory,
    dropHistory,
    historyInto,
    historyNow,
    jitterLens,
    makeHistory,
    sizeHistory,
    steadyLens,
    taaTargets,
    taaUniforms,
  };
}

// Exposed light squashed into 0 to 1 and back: the running picture's form.
const SQUASH = `/* glsl */ vec3 squash(vec3 hdrColor){ return hdrColor / (1.0 + max(hdrColor.r, max(hdrColor.g, hdrColor.b))); }
  vec3 unsquash(vec3 compressedColor){ return compressedColor / max(1.0 - max(compressedColor.r, max(compressedColor.g, compressedColor.b)), 1e-3); }`;
// The final pass's part (post-shaders.js, under TAA): steady(cur, mean, spread) returns the running picture at this pixel (squashed)
// from this frame's exposed light cur and its neighbourhood's mean and spread (standard deviation) in YCoCg. It needs the final
// pass's tDepth and uPx.
const TAA_FS = `/* glsl */ uniform sampler2D tHistory; uniform mat4 uReproj; uniform vec2 uJit; uniform float uFresh; ${SQUASH}
  vec3 toYCoCg(vec3 rgbColor){ return vec3(0.25 * rgbColor.r + 0.5 * rgbColor.g + 0.25 * rgbColor.b, 0.5 * rgbColor.r - 0.5 * rgbColor.b, -0.25 * rgbColor.r + 0.5 * rgbColor.g - 0.25 * rgbColor.b); }
  vec3 fromYCoCg(vec3 lumaChroma){ return vec3(lumaChroma.x + lumaChroma.y - lumaChroma.z, lumaChroma.x + lumaChroma.z, lumaChroma.x - lumaChroma.y - lumaChroma.z); }
  // where this pixel's point stood in the last frame's picture: carried by the nearest of five depths round it, so an edge moves
  // with what stands in front of it
  vec2 lastUv(vec2 uv){
    float d = texture2D(tDepth, uv).x; vec2 at = uv;
    for (int k = 0; k < 4; k++) {
      vec2 o = uv + vec2(k < 2 ? -1.0 : 1.0, k == 0 || k == 2 ? -1.0 : 1.0) * uPx; float e = texture2D(tDepth, o).x;
      if (e < d) { d = e; at = o; }
    }
    vec2 ndc = at * 2.0 - 1.0 - uJit;                    // where the point would stand without this frame's offset
    vec4 h = uReproj * vec4(ndc, d * 2.0 - 1.0, 1.0);
    return uv + (h.xy / h.w - ndc) * 0.5; }
  // the last picture at uv, by a Catmull-Rom spline from five filtered lookups: one filtered lookup would soften it a little more each frame
  vec3 lastAt(vec2 uv){
    vec2 p = uv / uPx, t1 = floor(p - 0.5) + 0.5, f = p - t1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2, t0 = (t1 - 1.0) * uPx, t3 = (t1 + 2.0) * uPx, t12 = (t1 + w2 / w12) * uPx;
    vec3 s = texture2D(tHistory, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y) + texture2D(tHistory, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
      + texture2D(tHistory, t12).rgb * (w12.x * w12.y) + texture2D(tHistory, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
      + texture2D(tHistory, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
    return max(s / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y), 0.0); }
  vec3 steady(vec3 cur, vec3 mean, vec3 spread){
    vec2 uv = lastUv(vUv);
    vec3 now = squash(cur);
    if (uFresh > 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return now;
    float slide = length((uv - vUv) / uPx);           // pixels the picture slid under the lens since the last frame
    vec3 last = toYCoCg(unsquash(lastAt(uv))), off = last - mean,
      a = abs(off / (spread * mix(${CLIP_STILL.toFixed(2)}, ${CLIP.toFixed(2)}, clamp(slide, 0.0, 1.0)) + 1e-4));
    float m = max(a.x, max(a.y, a.z));
    if (m > 1.0) last = mean + off / m;                // clipped to the neighbourhood's box, along the line to its middle
    float keep = mix(${KEEP.toFixed(3)}, ${KEEP_MOVING.toFixed(3)}, clamp(slide / ${KEEP_SLIDE.toFixed(1)}, 0.0, 1.0));
    return mix(squash(max(fromYCoCg(last), 0.0)), now, keep); }`;

export { SQUASH, TAA_FS };

import * as THREE from 'three';
import { createEyeAdaptation } from './eye-adapt.js';
import { DOF_BLUR, DOF_MOST, createDepthOfField } from './dof.js';
import { createTemporalAA } from './taa.js';
import { AO_FS, BLOOM, BLUR_FS, EASU_FS, FINAL_FS, GRADE, PRESENT_FS, QUAD_VS, RAY_FS, RCAS_FS } from './post-shaders.js';

// ════════════════════════════════════════════════════════════════════════
//  Post-processing: HDR scene, occlusion and light shafts, bloom -> ACES filmic, grade, vignette, sRGB
// ════════════════════════════════════════════════════════════════════════
// Two full-size passes a frame: the scene, and the final pass that puts everything together and writes the screen. Occlusion and light
// shafts are soft, so they are worked out at half size; bloom works at half size and below. None of them writes a full-size copy of the frame.
// Where a device cannot hold its preset at the picture's size, the world is drawn smaller (post.scale of each side, set by the quality
// fit) and brought up to the picture's size after the final pass, by an edge-adaptive upscale and a sharpening pass (the method of
// AMD's FSR 1). Overlay sprites render at the output resolution (drawnAtFullSize).
// With temporal anti-aliasing (taa.js) the scene is drawn with the lens moved a little each frame, the final pass keeps a running
// picture of it, tone-mapped, and a third full-size pass grades that onto the screen.
const DOF_EASE = 0.08; // how much of depth of field comes in or goes out a frame
const SHARPEN_STOPS = 0.25, // how far below its fullest the upscale's sharpening is held, in stops (0 is the strongest; FSR suggests about 0.2)
  STEADY_SHARPEN = 0.5; //     and the sharpening of the running picture where there is no upscale (taa.js), from 0 to 1

const OVER_ENCODED = `/* glsl */
  if (uGraded > 0.5) {
    gl_FragColor.rgb = gradeTail(gl_FragColor.rgb, gl_FragCoord.xy * uScreenPx);
    gl_FragColor.a = 1.0 - pow(1.0 - gl_FragColor.a, 1.0 / 2.2);
  }`;

/**
 * Create HDR, bloom, exposure, antialiasing and presentation passes for one camera.
 * createComposer(target) must return an EffectComposer using the supplied color target.
 * skyMask is a mesh whose material has tDepth and uPx uniforms and encodes occlusion in red.
 * getFrame() identifies the current frame for focusOn. expectedLogLuminance() gives the
 * scene's reference brightness in stops; adaptationStrength and maxExposureStops control
 * the exposure correction. Subsystems can also be shared with the host's camera controls.
 * Call setPost before sizePost, then render post.composer for each enabled frame.
 */
export function createPostProcessing({
  renderer,
  camera,
  scene,
  fxScene,
  skyMask,
  createComposer,
  getFrame,
  referenceLogLuminance = 0,
  expectedLogLuminance = () => referenceLogLuminance,
  adaptationStrength = 0.35,
  contactRadius = 0.25,
  contactStrength = () => 0,
  maxExposureStops = 0.8,
  eyeAdaptation = createEyeAdaptation(),
  depthOfField = createDepthOfField(),
  temporalAA = createTemporalAA(camera),
}) {
  const { adaptEye, eye, eyeMaterials } = eyeAdaptation;
  const { dof } = depthOfField;
  const { disposeHistory, historyInto, historyNow, jitterLens, makeHistory, sizeHistory, steadyLens, taaUniforms } = temporalAA;

  // What the particles read to fade where they meet the scene: the distance to what the scene drew at each pixel (the occlusion pass's
  // half-size target keeps it beside the occlusion), the size of a pixel, and whether there is one (only with post-processing).
  const sceneDepth = { uDepth: { value: null }, uDepthPx: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } };
  const post = { composer: null, bloom: null, final: null, on: false, samples: -1, taa: false, scale: 1, drawn: [1, 1] };
  // Uniforms shared by the final pass and the names drawn after it.
  const grade = {
    uVig: { value: 0.34 },
    uSat: { value: 0.95 },
    uTime: { value: 0 },
    uGraded: { value: 0 }, // 1 while post-processing is on: the names are then graded here as the picture is; else as the canvas does
    uScreenPx: { value: new THREE.Vector2(1, 1) }, // one pixel of the screen, as a share of it
  };
  // The upscale: its two passes, and its targets, which exist only while the world is drawn smaller (low: the graded picture at the drawn
  // size; full: after the first pass, at the screen's).
  const upscaleTarget = () =>
    new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const upscale = {
    low: null,
    full: null,
    easu: new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: QUAD_VS,
      fragmentShader: EASU_FS,
      uniforms: { tSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) } },
    }),
    rcas: new THREE.ShaderMaterial({
      depthFunc: THREE.AlwaysDepth,
      vertexShader: QUAD_VS,
      fragmentShader: RCAS_FS,
      uniforms: {
        tSrc: { value: null },
        tDepth: { value: null },
        uPx: { value: new THREE.Vector2(1, 1) },
        uSharp: { value: Math.pow(2, -SHARPEN_STOPS) },
        uTime: grade.uTime,
      },
    }),
  };
  // With temporal anti-aliasing, the pass that grades the running picture onto the screen (or into the upscale's first target).
  const present = new THREE.ShaderMaterial({
    depthFunc: THREE.AlwaysDepth,
    vertexShader: QUAD_VS,
    fragmentShader: PRESENT_FS,
    uniforms: {
      tSrc: { value: null },
      tDepth: { value: null },
      uPx: { value: new THREE.Vector2(1, 1) },
      uSharp: { value: STEADY_SHARPEN },
      uVig: grade.uVig,
      uSat: grade.uSat,
      uTime: grade.uTime,
    },
  });
  // Render overlays at output resolution with depth testing against the main scene.
  const overlay = new THREE.Scene();
  // A scene of one quad that covers the screen, for a post-processing pass.
  function fullScreen(material) {
    const s = new THREE.Scene(),
      q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    q.frustumCulled = false;
    s.add(q);
    return s;
  }
  // Depth of field while a scene's shot names a focus (dof.js): eased in over a few frames, and out when none is named.
  function focus(rn) {
    const named = dof.named >= getFrame() - 1;
    dof.weight = named ? Math.min(1, dof.weight + DOF_EASE) : Math.max(0, dof.weight - DOF_EASE);
    const d = dof.material.uniforms;
    d.uDof.value.x = dof.focus;
    d.uDof.value.w = dof.weight;
    if (dof.weight <= 0) return;
    d.tScene.value = post.sceneRT.texture;
    d.tDepth.value = post.sceneRT.depthTexture;
    d.uNF.value.set(camera.near, camera.far);
    rn.setRenderTarget(dof.target);
    rn.render(post.dofScene, post.aoCam);
  }
  // Whether any particle is alive (empty pools have their visibility turned off).
  function particlesShown() {
    const list = fxScene.children;
    for (let i = 0; i < list.length; i++) if (list[i].visible) return true;
    return false;
  }
  // Draws the particles over what is in `target` (null: the screen). With a target of one sample a pixel they fade by the depth the
  // occlusion pass has just kept (Medium and High); without post-processing, or over a multisampled target, they meet the scene hard
  // as before (its depth is not read: a multisampled target's colour is resolved again after them, its depth is not).
  function drawParticles(rn, target) {
    if (!particlesShown()) return;
    const soft = target !== null && !post.samples;
    sceneDepth.uSoft.value = soft ? 1 : 0;
    if (soft) {
      sceneDepth.uDepth.value = post.aoRT.texture;
      sceneDepth.uDepthPx.value.set(1 / post.aoRT.width, 1 / post.aoRT.height);
    }
    const clears = rn.autoClear,
      resolves = target?.resolveDepthBuffer;
    rn.autoClear = false;
    if (target) target.resolveDepthBuffer = false;
    rn.setRenderTarget(target);
    rn.render(fxScene, camera);
    if (target) target.resolveDepthBuffer = resolves;
    rn.autoClear = clears;
  }
  // Builds the post-processing chain described at the top of this module, with samples of anti-aliasing, and temporal
  // anti-aliasing where taa is true.
  function buildPost(samples, taa) {
    if (post.composer) {
      post.composer.renderTarget1.dispose();
      post.composer.renderTarget2.dispose();
      post.bloom.dispose();
      post.sceneRT.dispose();
      post.aoRT.dispose();
      post.rayRT.dispose();
      post.maskRT.dispose();
      dof.target.dispose();
      disposeHistory();
    }
    if (taa) makeHistory();
    post.taa = taa;
    dof.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBFormat, depthBuffer: false });
    dof.target.texture.internalFormat = 'R11F_G11F_B10F';
    // Only the scene itself is drawn into a multisampled target (with its depth, read back for ambient occlusion). Its colour is packed
    // floats with no alpha (32 bits a pixel, against 64 for half floats with alpha): writing, resolving and reading it is the larger part
    // of post-processing's cost, and the 6-bit mantissas are finer than the 8-bit screen after tone mapping.
    const sceneRT = (post.sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBFormat, samples }));
    sceneRT.texture.internalFormat = 'R11F_G11F_B10F';
    sceneRT.depthTexture = new THREE.DepthTexture(4, 4);
    sceneRT.depthTexture.type = THREE.UnsignedIntType;
    // The composer's own buffers stay at their smallest: no pass reads or writes them (shader warm-up renders into one).
    post.composer = createComposer(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
    post.samples = samples;
    post.composer.renderTarget1.setSize = post.composer.renderTarget2.setSize = function () {};
    post.rayRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false });
    post.maskRT = new THREE.WebGLRenderTarget(2, 2, { format: THREE.RedFormat, depthBuffer: false });
    const mask = skyMask.material.uniforms;
    mask.tDepth.value = sceneRT.depthTexture;
    post.maskScene = new THREE.Scene();
    post.maskScene.add(skyMask);
    post.aoRT = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    post.rayMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: QUAD_VS,
      fragmentShader: RAY_FS,
      uniforms: { tMask: { value: post.maskRT.texture }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } },
    });
    post.aoMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: QUAD_VS,
      fragmentShader: AO_FS,
      uniforms: {
        tDepth: { value: sceneRT.depthTexture },
        uNF: { value: new THREE.Vector2(camera.near, camera.far) },
        uTan: { value: new THREE.Vector2(1, 1) },
        uPx: { value: new THREE.Vector2(0.001, 0.001) },
        uAspect: { value: 1 },
        uAO: { value: 1 },
        uContact: { value: new THREE.Vector2(contactRadius, 0) },
      },
    });
    post.rayScene = fullScreen(post.rayMat);
    post.aoScene = fullScreen(post.aoMat);
    post.dofScene = fullScreen(dof.material);
    post.aoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // 1. The scene, then occlusion and shafts from it at half size.
    post.composer.addPass({
      enabled: true,
      needsSwap: false,
      clear: true,
      renderToScreen: false,
      setSize(w, h) {
        sceneRT.setSize(w, h);
        for (const t of [post.aoRT, post.rayRT, post.maskRT, dof.target]) t.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
        sizeHistory(w, h);
        const d = dof.material.uniforms;
        d.uPx.value.set(1 / w, 1 / h);
        d.uDof.value.y = DOF_BLUR * h;
        d.uDof.value.z = DOF_MOST * h;
        mask.uPx.value.set(1 / post.maskRT.width, 1 / post.maskRT.height);
      },
      render(rn) {
        const u = post.final.uniforms;
        rn.setRenderTarget(sceneRT);
        if (taa) jitterLens(sceneRT.width, sceneRT.height);
        rn.render(scene, camera);
        u.uPx.value.set(1 / sceneRT.width, 1 / sceneRT.height);
        u.uHp.value.set(1 / post.aoRT.width, 1 / post.aoRT.height);
        {
          const a = post.aoMat.uniforms;
          a.uPx.value.copy(u.uPx.value);
          a.uTan.value.copy(u.uTan.value);
          a.uAspect.value = u.uAspect.value;
          a.uAO.value = u.uAO.value;
          a.uContact.value.y = contactStrength();
          rn.setRenderTarget(post.aoRT);
          rn.render(post.aoScene, post.aoCam);
        }
        drawParticles(rn, sceneRT);
        if (taa) steadyLens();
        adaptEye(rn, sceneRT.texture);
        u.tEye.value = eye.level;
        u.uEye.value.x = expectedLogLuminance();
        focus(rn);
        if (u.uRay.value > 0.002) {
          rn.setRenderTarget(post.maskRT);
          rn.render(post.maskScene, camera);
          const a = post.rayMat.uniforms;
          a.uSun.value.copy(u.uSun.value);
          a.uAspect.value = u.uAspect.value;
          rn.setRenderTarget(post.rayRT);
          rn.render(post.rayScene, post.aoCam);
        }
      },
      dispose() {},
    });

    // 2. Bloom from the scene target.
    post.bloom = bloomPass(sceneRT);
    post.composer.addPass(post.bloom);

    // 3. Everything together, graded: to the screen, or where the world is drawn smaller, into a target of its size, which the upscale
    // brings to the screen's.
    const finalMat = new THREE.ShaderMaterial({
      depthFunc: THREE.AlwaysDepth, // it writes the scene's depth to the screen, whatever stood there
      defines: taa ? { TAA: 1 } : {},
      vertexShader: QUAD_VS,
      fragmentShader: FINAL_FS,
      uniforms: {
        tScene: { value: sceneRT.texture },
        tDepth: { value: sceneRT.depthTexture },
        tAO: { value: post.aoRT.texture },
        tRay: { value: post.rayRT.texture },
        ...Object.fromEntries(post.bloom.levels.map((l, i) => ['tBloom' + i, { value: l.v.texture }])),
        uBloomW: { value: post.bloom.weights },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uRay: { value: 0 },
        uAspect: { value: 1 },
        uRayCol: { value: new THREE.Color(1, 1, 1) },
        uNF: { value: new THREE.Vector2(camera.near, camera.far) },
        uTan: { value: new THREE.Vector2(1, 1) },
        uPx: { value: new THREE.Vector2(0.001, 0.001) },
        uAO: { value: 1 },
        uHp: { value: new THREE.Vector2(0.002, 0.002) },
        uExposure: { value: 1 },
        tEye: { value: eye.level },
        tDof: { value: dof.target.texture },
        uDof: dof.material.uniforms.uDof,
        uEye: { value: new THREE.Vector3(referenceLogLuminance, adaptationStrength, maxExposureStops) },
        uVig: grade.uVig,
        uSat: grade.uSat,
        uTime: grade.uTime,
        ...taaUniforms,
      },
    });
    const finalScene = fullScreen(finalMat),
      presentScene = fullScreen(present),
      easuScene = fullScreen(upscale.easu),
      rcasScene = fullScreen(upscale.rcas);
    upscale.rcas.uniforms.tDepth.value = present.uniforms.tDepth.value = sceneRT.depthTexture;
    post.final = {
      enabled: true,
      needsSwap: false,
      clear: false,
      renderToScreen: true,
      material: finalMat,
      uniforms: finalMat.uniforms,
      setSize() {}, // sized with the rest by sizePost
      render(rn) {
        if (taa) {
          rn.setRenderTarget(historyInto());
          rn.render(finalScene, post.aoCam);
          present.uniforms.tSrc.value = historyNow().texture;
        }
        rn.setRenderTarget(upscale.low); // the screen, where the world is drawn at its size
        rn.render(taa ? presentScene : finalScene, post.aoCam);
        if (!upscale.low) return;
        rn.setRenderTarget(upscale.full);
        rn.render(easuScene, post.aoCam);
        rn.setRenderTarget(null);
        rn.render(rcasScene, post.aoCam);
      },
      dispose() {},
    };
    post.composer.addPass(post.final);
  }
  // The materials of the passes after the scene, each with the target it is drawn into (null: the screen), for warming their
  // programs before the first frame .
  function postMaterials() {
    if (!post.composer) return [];
    const list = [
      [post.aoMat, post.aoRT],
      [post.rayMat, post.rayRT],
      [post.final.material, post.taa ? historyNow() : upscale.low],
    ];
    if (post.taa) list.push([present, upscale.low]);
    for (const l of post.bloom.levels) list.push([l.hMat, l.h], [l.vMat, l.v]);
    list.push(...eyeMaterials());
    list.push([dof.material, dof.target]);
    if (upscale.low) list.push([upscale.easu, upscale.full], [upscale.rcas, null]);
    return list;
  }
  // The bloom pass: bright parts blurred at falling sizes and added back over the picture.
  function bloomPass(sceneRT) {
    const quad = fullScreen(null),
      mesh = quad.children[0],
      cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const target = () => {
      const t = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBFormat, depthBuffer: false });
      t.texture.internalFormat = 'R11F_G11F_B10F';
      return t;
    };
    const blur = (k, first) => {
      const coeff = [];
      for (let j = 0; j < k; j++) coeff.push((0.39894 * Math.exp((-0.5 * j * j) / (k * k))) / k);
      return new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        vertexShader: QUAD_VS,
        fragmentShader: BLUR_FS,
        uniforms: {
          tSrc: { value: null },
          uStep: { value: new THREE.Vector2() },
          uK: { value: coeff },
          uTaps: { value: k },
          uBright: { value: first },
        },
      });
    };
    // each level is blurred across (hMat) into h, then down (vMat) into v; only the first blur across reads the scene and keeps its bright part
    const levels = BLOOM.kernels.map((k, i) => {
      const vMat = blur(k, false);
      return { h: target(), v: target(), hMat: i === 0 ? blur(k, true) : vMat, vMat };
    });
    // the levels' weights: strength, times the factor moved towards its mirror by the radius (as Three's composite does)
    const weights = BLOOM.factors.map(f => {
      const w = BLOOM.strength * THREE.MathUtils.lerp(f, 1.2 - f, BLOOM.radius);
      return new THREE.Vector3(w, w, w);
    });
    return {
      enabled: true,
      needsSwap: false,
      clear: true,
      renderToScreen: false,
      levels,
      weights,
      setSize(w, h) {
        let x = Math.round(w / 2),
          y = Math.round(h / 2);
        for (const l of levels) {
          l.h.setSize(x, y);
          l.v.setSize(x, y);
          l.size = [x, y];
          x = Math.round(x / 2);
          y = Math.round(y / 2);
        }
      },
      render(rn) {
        let from = sceneRT.texture;
        for (const l of levels) {
          let u = l.hMat.uniforms;
          mesh.material = l.hMat;
          u.tSrc.value = from;
          u.uStep.value.set(1 / l.size[0], 0);
          rn.setRenderTarget(l.h);
          rn.render(quad, cam);
          u = l.vMat.uniforms;
          mesh.material = l.vMat;
          u.tSrc.value = l.h.texture;
          u.uStep.value.set(0, 1 / l.size[1]);
          rn.setRenderTarget(l.v);
          rn.render(quad, cam);
          from = l.v.texture;
        }
      },
      dispose() {
        for (const l of levels) {
          l.h.dispose();
          l.v.dispose();
          l.hMat.dispose();
          l.vMat.dispose();
        }
      },
    };
  }
  function setPost(on, samples, taa) {
    if (on && (!post.composer || post.samples !== samples || post.taa !== taa)) buildPost(samples, taa);
    post.on = on;
    grade.uGraded.value = on ? 1 : 0;
  }
  // Sizes the passes for a screen of width x height pixels: the scene and everything worked out from it at post.scale of each side, and
  // where that is less than the screen the upscale's targets, which are let go again when the world is drawn at the screen's size.
  function sizePost(width, height) {
    const w = Math.max(1, Math.round(width * post.scale)),
      h = Math.max(1, Math.round(height * post.scale));
    post.drawn = [w, h];
    grade.uScreenPx.value.set(1 / width, 1 / height);
    for (const pass of post.composer.passes) pass.setSize(w, h);
    const smaller = w < width || h < height;
    present.uniforms.uPx.value.set(1 / w, 1 / h);
    present.uniforms.uSharp.value = smaller ? 0 : STEADY_SHARPEN;
    if (smaller !== !!upscale.low) {
      if (smaller) {
        upscale.low = upscaleTarget();
        upscale.full = upscaleTarget();
      } else {
        upscale.low.dispose();
        upscale.full.dispose();
        upscale.low = upscale.full = null;
      }
    }
    if (!smaller) return;
    upscale.low.setSize(w, h);
    upscale.full.setSize(width, height);
    upscale.easu.uniforms.tSrc.value = upscale.low.texture;
    upscale.easu.uniforms.uSrcSize.value.set(w, h);
    upscale.rcas.uniforms.tSrc.value = upscale.full.texture;
    upscale.rcas.uniforms.uPx.value.set(1 / width, 1 / height);
  }
  // The upscale's targets while they exist, for the reckoning of memory.
  const upscaleTargets = () => [upscale.low, upscale.full];
  // Composite a depth-tested sprite at output resolution. Adjust its alpha for
  // blending over encoded colour after the main grading pass.
  function drawnAtFullSize(sprite) {
    const material = sprite.material;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, grade);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `uniform float uGraded; uniform vec2 uScreenPx;\n${GRADE}\nvoid main() {`)
        .replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>\n${OVER_ENCODED}`);
    };
    material.customProgramCacheKey = () => 'drawn-at-full-size';
    overlay.add(sprite);
  }
  // Draws what is drawn at full size over the picture on the screen.
  function drawOverlay() {
    const clears = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlay, camera);
    renderer.autoClear = clears;
  }

  return {
    drawOverlay,
    drawParticles,
    drawnAtFullSize,
    overlay,
    post,
    postMaterials,
    sceneDepth,
    setPost,
    sizePost,
    upscaleTargets,
    depthOfField,
    temporalAA,
    eyeAdaptation,
  };
}

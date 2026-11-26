import * as THREE from 'three';
import { QUAD_VS } from './post-shaders.js';

// ════════════════════════════════════════════════════════════════════════
//  The eye's adaptation: how bright the picture is, metered on the card each frame (centre-weighted, as a camera meters) and
//  followed slowly, so that stepping from the street into a dark room opens the eye over a second or two, and facing a bright
//  sky closes it. The meter never leaves the card (no reading back, which would stall the frame): the scene is boiled down to
//  one texel of mean log brightness, and a second texel follows it over time; the final pass reads that one (tEye).
//  The eye adapts only round what the hour leads one to expect (ref, from the sun's height), and by a part of the difference,
//  held within a stop or so: night stays night and noon noon, as they were graded; what changes is a dark room, a bright sky.
// ════════════════════════════════════════════════════════════════════════
const METER = { w: 64, h: 36 }, // the first boiled-down picture, in texels: each takes 16 samples of the scene
  REDUCED = { w: 16, h: 9 }, //   then 4 x 4 of those to a texel, then all of these to one
  SPEED = { brighter: 2.4, darker: 0.9 }; // how fast the eye follows, a share a second: it closes on light faster than it opens in the dark

const LUM = `/* glsl */ float logLum(vec3 sceneColor){ return log2(max(dot(sceneColor, vec3(0.2126, 0.7152, 0.0722)), 1e-4)); }`;
// The scene to METER: the log brightness of 4 x 4 samples in each texel's span, weighted toward the middle of the picture, as (sum of
// weighted values, sum of weights) so later steps may average both and divide at the end.
const METER_FS = `/* glsl */ uniform sampler2D tSrc; uniform vec2 uSpan; varying vec2 vUv; ${LUM}
  void main(){
    float w = 1.0 - 0.75 * smoothstep(0.1, 0.75, length((vUv - 0.5) * vec2(1.6, 1.0)));
    float s = 0.0;
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      vec3 c = texture2D(tSrc, vUv + (vec2(float(i), float(j)) - 1.5) * 0.25 * uSpan).rgb;
      s += logLum(clamp(c, 0.0, 64.0));                  // an invalid or blinding pixel counts as bright, never as infinite
    }
    gl_FragColor = vec4(s / 16.0 * w, w, 0.0, 1.0);
  }`;
// Averages uN.x x uN.y texels of the source into one, keeping the two sums: one program for both steps, its loops running to the
// larger block and stopping at uN, so each step sums the same texels in the same order as loops of its own length did.
const REDUCE_FS = `/* glsl */ uniform sampler2D tSrc; uniform vec2 uPx; uniform ivec2 uN; varying vec2 vUv;
  void main(){
    vec2 s = vec2(0.0);
    vec2 o = vUv - (vec2(uN) * 0.5 - 0.5) * uPx;
    for (int j = 0; j < ${REDUCED.h}; j++) {
      if (j >= uN.y) break;
      for (int i = 0; i < ${REDUCED.w}; i++) { if (i >= uN.x) break; s += texture2D(tSrc, o + vec2(float(i), float(j)) * uPx).rg; }
    }
    gl_FragColor = vec4(s / float(uN.x * uN.y), 0.0, 1.0);
  }`;
// The eye: last frame's level moved toward this frame's mean by its share of the time passed.
const ADAPT_FS = `/* glsl */ uniform sampler2D tMean, tPrev; uniform float uDt, uFirst; varying vec2 vUv;
  void main(){
    vec2 m = texture2D(tMean, vec2(0.5)).rg;
    float now = m.r / max(m.g, 1e-4), prev = texture2D(tPrev, vec2(0.5)).r;
    float k = 1.0 - exp(-uDt * (now > prev ? ${SPEED.brighter.toFixed(2)} : ${SPEED.darker.toFixed(2)}));
    gl_FragColor = vec4(uFirst > 0.5 ? now : prev + (now - prev) * k, 0.0, 0.0, 1.0);
  }`;

const target = (width, height, format) =>
  new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
const pass = (fragmentShader, uniforms) =>
  new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: QUAD_VS, fragmentShader, uniforms });

export function createEyeAdaptation() {
  // The meter's targets and passes, made once for the page; eye.level is the texture the final pass reads.
  const meter = target(METER.w, METER.h, THREE.RGFormat),
    reduced = target(REDUCED.w, REDUCED.h, THREE.RGFormat),
    mean = target(1, 1, THREE.RGFormat),
    levels = [target(1, 1, THREE.RedFormat), target(1, 1, THREE.RedFormat)],
    meterMat = pass(METER_FS, { tSrc: { value: null }, uSpan: { value: new THREE.Vector2(1 / METER.w, 1 / METER.h) } }),
    reduceMat = pass(REDUCE_FS, {
      tSrc: { value: meter.texture },
      uPx: { value: new THREE.Vector2(1 / METER.w, 1 / METER.h) },
      uN: { value: new THREE.Vector2(METER.w / REDUCED.w, METER.h / REDUCED.h) },
    }),
    meanMat = pass(REDUCE_FS, {
      tSrc: { value: reduced.texture },
      uPx: { value: new THREE.Vector2(1 / REDUCED.w, 1 / REDUCED.h) },
      uN: { value: new THREE.Vector2(REDUCED.w, REDUCED.h) },
    }),
    adaptMat = pass(ADAPT_FS, { tMean: { value: mean.texture }, tPrev: { value: null }, uDt: { value: 0 }, uFirst: { value: 1 } }),
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), meterMat),
    quadScene = new THREE.Scene(),
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const eye = { level: levels[0].texture, flip: 0, last: 0 };

  function draw(renderer, material, into) {
    quad.material = material;
    renderer.setRenderTarget(into);
    renderer.render(quadScene, quadCam);
  }
  // Meters the scene's picture (a texture of light before tone mapping) and moves the eye on; a pause of more than a second (a
  // crossing, a page that was hidden) starts the eye afresh where it looks.
  function adaptEye(renderer, sceneTexture) {
    const now = performance.now(),
      deltaSeconds = (now - eye.last) / 1000;
    eye.last = now;
    meterMat.uniforms.tSrc.value = sceneTexture;
    draw(renderer, meterMat, meter);
    draw(renderer, reduceMat, reduced);
    draw(renderer, meanMat, mean);
    const from = levels[eye.flip],
      into = levels[1 - eye.flip];
    adaptMat.uniforms.tPrev.value = from.texture;
    adaptMat.uniforms.uDt.value = Math.min(deltaSeconds, 0.1);
    adaptMat.uniforms.uFirst.value = deltaSeconds > 1 ? 1 : 0;
    draw(renderer, adaptMat, into);
    eye.flip = 1 - eye.flip;
    eye.level = into.texture;
  }
  // The meter's materials with the targets they draw into, for warming their programs before the first frame.
  const eyeMaterials = () => [
    [meterMat, meter],
    [reduceMat, reduced],
    [meanMat, mean],
    [adaptMat, levels[0]],
  ];

  return { adaptEye, eye, eyeMaterials };
}

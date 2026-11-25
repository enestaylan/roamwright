import { SQUASH, TAA_FS } from './taa.js';

// ════════════════════════════════════════════════════════════════════════
//  The shaders of post-processing (post.js): light shafts, ambient occlusion, bloom's blur, the final pass that puts them
//  together with tone mapping and the grade, and the two halves of the upscale. Bloom's settings are here, since its blur
//  bakes its threshold in.
// ════════════════════════════════════════════════════════════════════════
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Light shafts: open sky round the sun is smeared away from it. The supplied sky mask is 0 for open sky, the cover for cloud, 1 for solid things.
const RAY_FS = `/* glsl */ uniform sampler2D tMask; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
  void main(){ vec2 dv = (uSun - vUv) / 30.0, uv = vUv + dv * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); float acc = 0.0, w = 1.0;
    for (int i = 0; i < 30; i++) { uv += dv; vec2 q = (uv - uSun) * vec2(uAspect, 1.0); acc += clamp(1.0 - texture2D(tMask, clamp(uv, 0.001, 0.999)).x, 0.0, 1.0) * exp(-dot(q, q) * 9.0) * w; w *= 0.96; }
    gl_FragColor = vec4(acc / 30.0, 0.0, 0.0, 1.0); }`;

// Ambient occlusion from the depth buffer alone: corners, eaves, doorways and the ground under things darken. Stored with the depth it was taken at.
const AO_FS = `/* glsl */ uniform sampler2D tDepth; uniform vec2 uNF, uTan, uPx; uniform float uAspect, uAO; uniform vec2 uContact; varying vec2 vUv;
  vec3 vp(vec2 uv){ uv = (floor(uv / uPx) + 0.5) * uPx;      // every lookup is moved onto the centre of a depth texel, so the position and the depth it is built from always belong together (otherwise thin dark lines cross flat ground, worst on phones)
    float z = uNF.x * uNF.y / ((uNF.y - uNF.x) * texture2D(tDepth, uv).x - uNF.y); return vec3((uv * 2.0 - 1.0) * uTan * -z, z); }
  void main(){ vec2 uv = (floor(vUv / uPx) + 0.5) * uPx;      // a half-size pixel's centre is the corner of four depth texels: step onto one, or rounding picks a different one from row to row and draws lines
    vec3 P = vp(uv); float dist = -P.z, ao = 1.0;
    if (dist < 240.0) {
      vec3 px = vp(uv + vec2(uPx.x, 0.0)) - P, mx = P - vp(uv - vec2(uPx.x, 0.0)), py = vp(uv + vec2(0.0, uPx.y)) - P, my = P - vp(uv - vec2(0.0, uPx.y));
      vec3 N = normalize(cross(abs(px.z) < abs(mx.z) ? px : mx, abs(py.z) < abs(my.z) ? py : my));
      float rad = 0.4 + 0.012 * dist, sr = clamp(rad / dist / (2.0 * uTan.y), 3.0 * uPx.y, 0.1), bias = 0.015 + 0.003 * dist, occ = 0.0;
      float a0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
      for (int i = 0; i < 14; i++) {
        float an = a0 + float(i) * 2.39996; vec2 o = vec2(cos(an) / uAspect, sin(an)) * (sqrt((float(i) + 0.5) / 14.0) * sr);
        vec3 d = vp(uv + o) - P; float dd = dot(d, d);
        occ += max(dot(N, d) - bias, 0.0) / (dd + 0.0004 + 0.02 * rad * rad) * (1.0 - smoothstep(rad * rad, rad * rad * 4.0, dd));   // what lies within a seventh of the radius counts less: a face's nose and brow made few samples weigh so much that the cheeks were speckled
      }
      float reach = sr * dist * 2.0 * uTan.y;             // how far the samples really reach in the world once the screen's cap has bitten (metres)
      ao = mix(clamp(1.0 - uAO * occ * rad / 14.0 * 2.1, 0.0, 1.0), 1.0, max(smoothstep(120.0, 240.0, dist), 1.0 - smoothstep(0.04, 0.12, reach)));   // under a hand's breadth it would shade a nose's own curve: a face seen close was smeared dark beside the nose
      // Four nearer samples resolve local contacts that can fall inside the first spiral tap.
      // Skip subpixel contacts, and vary spacing by depth so the radius remains in world units.
      if (uContact.y > 0.0 && dist > 1.5 && dist < 45.0) {
        float r = uContact.x, screenRadius = min(r / (dist * 2.0 * uTan.y), 0.06);
        float pixels = screenRadius / uPx.y;
        if (pixels > 1.5) {
          float contact = 0.0;
          vec2 direction = vec2(0.923880, 0.382683);
          for (int j = 0; j < 4; j++) {
            vec2 dUV = direction * vec2(1.0 / uAspect, 1.0) * screenRadius;
            direction = vec2(-direction.y, direction.x);
            vec3 delta = vp(uv + dUV) - P;
            float separation = length(delta);
            float horizon = clamp((dot(N, delta) - r * 0.045) / max(separation, r * 0.12), 0.0, 1.0);
            contact += horizon * (1.0 - smoothstep(r * 0.4, r * 2.0, separation));
          }
          float scale = smoothstep(1.5, 3.0, pixels) * smoothstep(1.5, 3.0, dist) * (1.0 - smoothstep(32.0, 45.0, dist));
          ao *= 1.0 - clamp(uContact.y * 0.25 * contact * scale, 0.0, 0.55);
        }
      }
    }
    gl_FragColor = vec4(ao, dist, 0.0, 1.0); }`;

// Additive blending can overflow the half-float buffer; one infinite or invalid pixel would be smeared by bloom into a black square,
// so both the bloom's input and the final pass make every pixel finite and cap it.
const SANE =
  'vec3 sane(vec3 c){ if (!(c.r >= 0.0)) c.r = 0.0; if (!(c.g >= 0.0)) c.g = 0.0; if (!(c.b >= 0.0)) c.b = 0.0; return min(c, vec3(48.0)); }';

// Bloom: what is brighter than BLOOM.threshold is blurred at five sizes, from half the frame down to a thirty-second, each level blurred
// across and then down with a wider Gaussian (the same blur and weights as Three's UnrealBloomPass), and the final pass adds the five.
// The first blur reads the scene itself and keeps only its bright part, so no half-size copy of the bright part is written first.
const BLOOM = { strength: 0.46, radius: 0.5, threshold: 0.95, knee: 0.01, kernels: [3, 5, 7, 9, 11], factors: [1.0, 0.8, 0.6, 0.4, 0.2] };
// The fragment shader of one blur direction for bloom, shared by every level (one program): uTaps of the weights uK are used, and
// the first pass (uBright) also keeps only the bright parts. The loop runs to the widest kernel and stops at uTaps, which every
// pixel of a pass shares, so each level sums the same samples in the same order as a loop of its own length did.
const BLUR_TAPS = Math.max(...BLOOM.kernels);
const BLUR_FS = `/* glsl */ uniform sampler2D tSrc; uniform vec2 uStep; uniform float uK[${BLUR_TAPS}]; uniform int uTaps; uniform bool uBright;
  varying vec2 vUv; ${SANE}
  vec3 src(vec2 uv){
    if (uBright) { vec3 c = sane(texture2D(tSrc, uv).rgb); return c * smoothstep(${BLOOM.threshold.toFixed(3)}, ${(BLOOM.threshold + BLOOM.knee).toFixed(3)}, dot(c, vec3(0.2126, 0.7152, 0.0722))); }
    return texture2D(tSrc, uv).rgb; }
  void main(){ float ws = uK[0]; vec3 s = src(vUv) * ws;
    for (int i = 1; i < ${BLUR_TAPS}; i++) { if (i >= uTaps) break; vec2 o = uStep * float(i); s += (src(vUv + o) + src(vUv - o)) * uK[i]; ws += 2.0 * uK[i]; }
    gl_FragColor = vec4(s / ws, 1.0); }`;

// The grade after tone mapping: saturation, a touch of contrast, cool shadows and warm lights, the vignette. Shared by the final
// pass and the names drawn after it, so both are graded alike.
const GRADE = `/* glsl */ uniform float uVig, uSat;
  vec3 gradeTail(vec3 c, vec2 uv){
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);
    c *= mix(vec3(0.95, 0.985, 1.06), vec3(1.045, 1.0, 0.95), smoothstep(0.0, 0.75, l));
    vec2 q = uv - 0.5; return c * (1.0 - uVig * smoothstep(0.22, 1.0, dot(q, q) * 2.3)); }`;
// A pixel's own noise of half a step of the 8-bit screen, against banding.
const DITHER = '(fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0';

// Depth of field (dof.js): the circle of confusion at view depth z, in pixels of the full picture, from uDof (focus distance,
// the circle far behind it and the widest circle, both in pixels, and how far the effect is in); and what the final pass mixes in by it.
const DOF_COC = `/* glsl */ float cocAt(float z){ return min(uDof.y * abs(z - uDof.x) / max(z, 0.05), uDof.z); }`;
const DOF_MIX = `/* glsl */
    if (uDof.w > 0.0) { soft = texture2D(tDof, vUv).rgb; softShare = smoothstep(0.8, 2.5, cocAt(viewDepth(vUv))) * uDof.w; }`;
// ACES fitted curve by Stephen Hill, from Baking Lab (licenses/baking-lab.txt), as used in Three.js (licenses/three.txt).
const ACES = `/* glsl */ vec3 fit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 acesCurve(vec3 c){
    const mat3 mi = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 mo = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    return clamp(mo * fit(mi * c), 0.0, 1.0); }`;
// Light as the screen shows it, encoded for it (sRGB).
const ENCODE = 'c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));';
// With temporal anti-aliasing (taa.js) the final pass writes the running picture (exposed light, squashed) and the present
// pass tone-maps and grades it onto the screen. The running picture's neighbourhood is this frame's scene at the pixel and the eight
// round it, in YCoCg, lit as the pixel itself is: its depth of field, occlusion, shafts and bloom are soft enough to be shared by
// its neighbours, so they make one gain and one lift for all five, which carry the neighbourhood's mean and spread over whole.
// Four neighbours made a box that changed with each step of the lens, so every edge flickered in a still picture.
const STEADY = `/* glsl */
    float ex = uExposure * eyeEx / 0.6, gain = shade * (1.0 - softShare) * ex;
    vec3 lift = toYCoCg((soft * softShare * shade + rays + bloom) * ex), y = toYCoCg(min(raw, vec3(48.0))), m1 = y, m2 = y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv - vec2(uPx.x, 0.0)).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv + vec2(uPx.x, 0.0)).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv - vec2(0.0, uPx.y)).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv + vec2(0.0, uPx.y)).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv - uPx).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv + uPx).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv + vec2(uPx.x, -uPx.y)).rgb)); m1 += y; m2 += y * y;
    y = toYCoCg(sane(texture2D(tScene, vUv + vec2(-uPx.x, uPx.y)).rgb)); m1 += y; m2 += y * y;
    vec3 mean = m1 / 9.0, spread = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
    gl_FragColor = vec4(steady(c * ex, mean * gain + lift, spread * gain), 1.0);`;
const FINAL_FS = `/* glsl */ uniform sampler2D tScene, tDepth, tAO, tRay, tBloom0, tBloom1, tBloom2, tBloom3, tBloom4; uniform vec3 uBloomW[5]; uniform vec2 uSun, uNF, uTan, uPx, uHp; uniform float uRay, uAspect, uAO, uExposure, uTime; uniform vec3 uRayCol; uniform sampler2D tEye, tDof; uniform vec3 uEye; uniform vec4 uDof; varying vec2 vUv;
  float eyeEx = 1.0;
  ${SANE}
  ${GRADE}
#ifdef TAA
  ${TAA_FS}
#endif
  float viewDepth(vec2 uv){ return -uNF.x * uNF.y / ((uNF.y - uNF.x) * texture2D(tDepth, uv).x - uNF.y); }
  ${DOF_COC}
  ${ACES}
  vec3 exposed(vec3 c){ return c * uExposure * eyeEx / 0.6; }
  vec3 aces(vec3 c){ return acesCurve(exposed(c)); }
  void main(){
    // the eye: a part of how far the metered brightness lies from what the hour leads one to expect (uEye: expected log2 brightness,
    // the part, and how far either way at most, in stops), so a dark room opens it and a bright sky closes it
    eyeEx = exp2(clamp(uEye.y * (uEye.x - texture2D(tEye, vec2(0.5)).r), -uEye.z, uEye.z));
    vec3 c = texture2D(tScene, vUv).rgb; if (!(c.r >= 0.0)) c.r = 0.0; if (!(c.g >= 0.0)) c.g = 0.0; if (!(c.b >= 0.0)) c.b = 0.0;
    vec3 raw = c, soft = vec3(0.0), rays = vec3(0.0); float softShare = 0.0, shade = 1.0;   // the scene's light; depth of field, occlusion, the shafts
${DOF_MIX}
    c = mix(c, soft, softShare);
    if (uAO > 0.0) {                                     // occlusion was worked out at half size, each pixel's samples turned its own way: a tent three
      float z = viewDepth(vUv);                          // of its pixels wide over the nine nearest smooths that turning into an even shade (alone it
      if (z < 240.0) {                                   // speckles a curved surface, a cheek beside the nose), trusting the values at this pixel's own depth
        vec2 g = floor(vUv / uHp), o = vUv / uHp - g - 0.5; float aoS = 0.0, wS = 0.0;
        for (int j = -1; j < 2; j++) for (int i = -1; i < 2; i++) {
          vec2 sm = texture2D(tAO, (g + vec2(float(i), float(j)) + 0.5) * uHp).rg;
          float w = max(0.0, 1.5 - abs(float(i) - o.x)) * max(0.0, 1.5 - abs(float(j) - o.y)) / (0.004 + abs(sm.g - z) / z) + 1e-5;
          aoS += sm.r * w; wS += w;
        }
        shade = 0.3 + 0.7 * mix(aoS / wS, 1.0, smoothstep(1.5, 5.0, max(c.r, max(c.g, c.b))));
        c *= shade;
      }
    }
    if (uRay > 0.002) {                                  // the shafts were smeared at half size (they are soft); here they are only added
      vec2 q0 = (vUv - uSun) * vec2(uAspect, 1.0);
      float sh = texture2D(tRay, vUv).r * uRay * 2.2 * exp(-dot(q0, q0) * 1.2);
      rays = uRayCol * (0.6 * (1.0 - exp(-sh * 1.2)));     // soft-capped, so facing a low sun gives a glow with shafts in it, not a white-out
    }
    c = min(c + rays, vec3(48.0));
    vec3 bloom = uBloomW[0] * texture2D(tBloom0, vUv).rgb + uBloomW[1] * texture2D(tBloom1, vUv).rgb + uBloomW[2] * texture2D(tBloom2, vUv).rgb
      + uBloomW[3] * texture2D(tBloom3, vUv).rgb + uBloomW[4] * texture2D(tBloom4, vUv).rgb;
    c += bloom;
#ifdef TAA
${STEADY}
#else
    c = gradeTail(aces(c), vUv);
    ${ENCODE}
    gl_FragColor = vec4(c + ${DITHER}, 1.0);
    gl_FragDepth = texture2D(tDepth, vUv).x;            // the screen keeps the scene's depth, for the names drawn after (drawnAtFullSize)
#endif
  }`;
// Edge adaptation and sharpening follow AMD FidelityFX Super Resolution 1 (licenses/fidelityfx-fsr.txt).
// A sharpening held within its neighbours (as FSR 1's RCAS): e is pushed away from the four round it (b above, d left, f right, h below)
// by up to sharp (0 to 1), only as far as keeps it inside their range, so edges come back crisp without halos.
const SHARPEN = `/* glsl */ vec3 sharpen(vec3 b, vec3 d, vec3 e, vec3 f, vec3 h, float sharp){
    vec3 mn = min(min(b, d), min(f, h)), mx = max(max(b, d), max(f, h));
    vec3 lobes = max(-min(mn, e) / (4.0 * mx + 1e-5), (1.0 - max(mx, e)) / (4.0 * mn - 4.0 - 1e-5));
    float lobe = max(-0.1875, min(max(lobes.r, max(lobes.g, lobes.b)), 0.0)) * sharp;
    return (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0); }`;
// The present pass, with temporal anti-aliasing: the running picture sharpened a little (a running picture is a little softer than one
// frame; where the upscale follows, its own sharpening does this), tone-mapped, graded and encoded for the screen, with its noise and
// the depth.
const PRESENT_FS = `/* glsl */ uniform sampler2D tSrc, tDepth; uniform vec2 uPx; uniform float uSharp, uTime; varying vec2 vUv;
  ${GRADE}
  ${SHARPEN}
  ${ACES}
  ${SQUASH}
  vec3 at(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uPx).rgb; }
  void main(){
    vec3 c = at(0.0, 0.0);
    if (uSharp > 0.0) c = sharpen(at(0.0, 1.0), at(-1.0, 0.0), c, at(1.0, 0.0), at(0.0, -1.0), uSharp);
    c = gradeTail(acesCurve(unsquash(c)), vUv);
    ${ENCODE}
    gl_FragColor = vec4(c + ${DITHER}, 1.0);
    gl_FragDepth = texture2D(tDepth, vUv).x; }`;

// The upscale's first half, edge-adaptive (as FSR 1's EASU): twelve texels round the sample, weighted by a windowed Lanczos-2 that is
// stretched along the edge the four nearest texels show and narrowed across it, then held within those four, so it neither blurs nor rings.
// Works on the graded picture, where steps of light are as the eye sees them.
const EASU_FS = `/* glsl */ uniform sampler2D tSrc; uniform vec2 uSrcSize; varying vec2 vUv;
  vec3 tap(vec2 p){ return texture2D(tSrc, (p + 0.5) / uSrcSize).rgb; }
  float luma(vec3 c){ return c.g + 0.5 * (c.r + c.b); }
  // the edge at one of the four central texels, from its four neighbours, weighted by the sample's nearness to it: its direction, and how
  // much it is an edge (a step on one side only) rather than a thin line or noise (steps both ways)
  void edge(inout vec2 dir, inout float len, float w, float up, float left, float mid, float right, float down){
    float dx = right - left, dy = down - up;
    float lx = clamp(abs(dx) / max(max(abs(right - mid), abs(mid - left)), 1e-5), 0.0, 1.0);
    float ly = clamp(abs(dy) / max(max(abs(down - mid), abs(mid - up)), 1e-5), 0.0, 1.0);
    dir += vec2(dx, dy) * w; len += (lx * lx + ly * ly) * w; }
  // one texel's share: off is from the sample to the texel, turned onto the edge and scaled by len2; lob is the negative lobe's depth
  void take(inout vec3 sum, inout float wsum, vec3 c, vec2 off, vec2 dir, vec2 len2, float lob, float clp){
    vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len2;
    float d2 = min(dot(v, v), clp), wb = 0.4 * d2 - 1.0, wa = lob * d2 - 1.0;
    wb = 1.5625 * wb * wb - 0.5625; float w = wb * wa * wa;
    sum += c * w; wsum += w; }
  void main(){
    vec2 pp = vUv * uSrcSize - 0.5, p = floor(pp), f = pp - p;
    //      b c
    //    e F g h        F is the texel at or before the sample, k the one after it both ways
    //    i j k l
    //      n o
    vec3 b = tap(p + vec2(0.0, -1.0)), c = tap(p + vec2(1.0, -1.0)), e = tap(p + vec2(-1.0, 0.0)), F = tap(p), g = tap(p + vec2(1.0, 0.0)),
      h = tap(p + vec2(2.0, 0.0)), i = tap(p + vec2(-1.0, 1.0)), j = tap(p + vec2(0.0, 1.0)), k = tap(p + vec2(1.0, 1.0)),
      l = tap(p + vec2(2.0, 1.0)), n = tap(p + vec2(0.0, 2.0)), o = tap(p + vec2(1.0, 2.0));
    float lb = luma(b), lc = luma(c), le = luma(e), lF = luma(F), lg = luma(g), lh = luma(h), li = luma(i), lj = luma(j), lk = luma(k),
      ll = luma(l), ln = luma(n), lo = luma(o);
    vec2 dir = vec2(0.0); float len = 0.0;
    edge(dir, len, (1.0 - f.x) * (1.0 - f.y), lb, le, lF, lg, lj);
    edge(dir, len, f.x * (1.0 - f.y), lc, lF, lg, lh, lk);
    edge(dir, len, (1.0 - f.x) * f.y, lF, li, lj, lk, ln);
    edge(dir, len, f.x * f.y, lg, lj, lk, ll, lo);
    float d2 = dot(dir, dir);
    dir = d2 < 1.0 / 32768.0 ? vec2(1.0, 0.0) : dir * inversesqrt(d2);
    len *= 0.5; len *= len;
    float stretch = 1.0 / max(abs(dir.x), abs(dir.y));     // 1 along an axis, the square root of 2 on a diagonal
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 - 0.29 * len, clp = 1.0 / lob;
    vec3 sum = vec3(0.0); float ws = 0.0;
    take(sum, ws, b, vec2(0.0, -1.0) - f, dir, len2, lob, clp); take(sum, ws, c, vec2(1.0, -1.0) - f, dir, len2, lob, clp);
    take(sum, ws, e, vec2(-1.0, 0.0) - f, dir, len2, lob, clp); take(sum, ws, F, -f, dir, len2, lob, clp);
    take(sum, ws, g, vec2(1.0, 0.0) - f, dir, len2, lob, clp); take(sum, ws, h, vec2(2.0, 0.0) - f, dir, len2, lob, clp);
    take(sum, ws, i, vec2(-1.0, 1.0) - f, dir, len2, lob, clp); take(sum, ws, j, vec2(0.0, 1.0) - f, dir, len2, lob, clp);
    take(sum, ws, k, vec2(1.0, 1.0) - f, dir, len2, lob, clp); take(sum, ws, l, vec2(2.0, 1.0) - f, dir, len2, lob, clp);
    take(sum, ws, n, vec2(0.0, 2.0) - f, dir, len2, lob, clp); take(sum, ws, o, vec2(1.0, 2.0) - f, dir, len2, lob, clp);
    gl_FragColor = vec4(clamp(sum / ws, min(min(F, g), min(j, k)), max(max(F, g), max(j, k))), 1.0); }`;

// The upscale's second half: the screen's picture sharpened (SHARPEN). Writes the screen, with its noise and the depth.
const RCAS_FS = `/* glsl */ uniform sampler2D tSrc, tDepth; uniform vec2 uPx; uniform float uSharp, uTime; varying vec2 vUv; ${SHARPEN}
  vec3 at(float x, float y){ return texture2D(tSrc, (gl_FragCoord.xy + vec2(x, y)) * uPx).rgb; }
  void main(){
    vec3 c = sharpen(at(0.0, 1.0), at(-1.0, 0.0), at(0.0, 0.0), at(1.0, 0.0), at(0.0, -1.0), uSharp);
    gl_FragColor = vec4(c + ${DITHER}, 1.0);
    gl_FragDepth = texture2D(tDepth, vUv).x; }`;

export { AO_FS, BLOOM, DOF_COC, BLUR_FS, EASU_FS, FINAL_FS, GRADE, PRESENT_FS, QUAD_VS, RAY_FS, RCAS_FS };

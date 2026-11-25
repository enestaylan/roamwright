import { MeshStandardMaterial, MeshDepthMaterial, RGBADepthPacking, Color } from 'three';

import { terrainReliefGLSL } from './terrain-rock.js';

const CLIFF_FRAG_HEAD = `/* glsl */
uniform vec3 uDark, uLight, uIron, uShale, uDust, uLichen, uCrust, uSnow;
uniform sampler2D uRockTex; uniform float uSnowline;
varying vec3 vWP, vWN; varying vec4 vRock; varying float vYY; float gH = 0.5; float gSnow = 0.0;
vec3 rockTri(vec3 p, vec3 bw, float s, float o) { return texture2D(uRockTex, p.zy * s + o).rgb * bw.x + texture2D(uRockTex, p.xz * s + o).rgb * bw.y + texture2D(uRockTex, p.xy * s + o).rgb * bw.z; }`;
const CLIFF_FRAG = `/* glsl */
#include <color_fragment>
  {
    vec3 wn = normalize(vWN), bw = abs(wn); bw *= bw; bw *= bw; bw /= bw.x + bw.y + bw.z;
    float vd = length(vViewPosition), nearK = 1.0 - smoothstep(10.0, 55.0, vd), midK = 1.0 - smoothstep(60.0, 320.0, vd);
    float px = length(fwidth(vWP));                                                                          // metres to a pixel
    // each scale's relief is let go before its grain is finer than a pixel, or its slope taken pixel to pixel lies as a stipple
    float k1 = 1.0 - smoothstep(0.003, 0.009, px), k2 = 1.0 - smoothstep(0.017, 0.05, px), k3 = 1.0 - smoothstep(0.1, 0.3, px);
    vec3 f3 = rockTri(vWP, bw, 0.041, 0.57), f2 = vec3(0.5, 0.0, f3.b), f1 = vec3(0.5, 0.0, 0.5);       // the finer scales only where they show
    if (midK > 0.0) f2 = mix(f2, rockTri(vWP, bw, 0.23, 0.31), midK);
    if (nearK > 0.0) f1 = rockTri(vWP, bw, 1.37, 0.0);
    float t = vRock.x, hard = vRock.y, cav = vRock.z, m = vRock.w;
    vec3 rock = mix(uDark, uLight, t);                                     // grey-brown to pale buff, bed by bed
    rock = mix(rock, uIron, smoothstep(0.8, 0.93, t) * 0.75);                               // a few beds stained with iron
    rock = mix(rock, uShale, smoothstep(0.16, 0.04, t) * 0.7);                              // and a few dark ones
    float lam = sin(vYY * 7.3 + f2.r * 4.0) * 0.5 + 0.5;
    rock *= 1.0 - 0.1 * (1.0 - hard) * lam * midK * (1.0 - smoothstep(0.08, 0.2, fwidth(vYY)));                                                          // soft beds split into thin laminae
    float gl = max(dot(vColor.rgb, vec3(0.3, 0.55, 0.15)), 0.02);
    rock *= mix(vec3(1.0), clamp(vColor.rgb / gl, 0.7, 1.4), 0.35);                                          // the hue of the ground round it
    rock *= (0.68 + 0.64 * mix(0.5, f1.r, nearK)) * (0.78 + 0.44 * f2.r) * (0.82 + 0.36 * f3.r);
    rock *= 1.0 - 0.16 * f2.g * nearK - 0.16 * f1.g * nearK;                                                // cracks, seen from near
    // Weathering follows the rock grain in fixed world space, including on a curving face.
    float streak = mix(f3.b, f2.b, 0.35);
    float top = smoothstep(0.52, 0.86, wn.y);
    rock *= mix(0.8 + 0.4 * smoothstep(0.3, 0.7, streak), 1.0, smoothstep(0.25, 0.55, wn.y));
    rock *= 1.0 - 0.55 * cav;
    vec3 dust = mix(uDust, vColor.rgb, 0.3) * (0.75 + 0.5 * f2.r);
    rock = mix(rock, dust, top * (0.35 + 0.35 * f3.g) * (1.0 - 0.4 * hard));                                // dust and grit on the ledges
    float lich = smoothstep(0.58, 0.78, f3.b * 0.55 + f2.b * 0.45 + 0.1 * top) * (0.35 + 0.65 * top);
    rock = mix(rock, uLichen * (0.6 + 0.8 * f1.r), lich * 0.42);                             // grey-green lichen, thickest on the tops
    rock = mix(rock, uCrust * (0.7 + 0.5 * f1.r), smoothstep(0.83, 0.92, f2.b) * smoothstep(0.4, 0.7, f3.b) * 0.5 * nearK);   // and a few orange crusts
    float foot = 1.0 - smoothstep(0.12, 0.5, m);
    rock = mix(rock, vColor.rgb * (0.85 + 0.45 * f2.r) * 1.35, foot * 0.8);                                   // where it rises out of the ground
    float snowline = uSnowline + (f3.g - 0.5) * 60.0;
    gSnow = smoothstep(snowline, snowline + 30.0, vWP.y) * smoothstep(0.66, 0.86, wn.y + (f2.r - 0.5) * 0.25) * 0.9;
    rock = mix(rock, uSnow * (0.92 + 0.1 * f1.r), gSnow);                                   // snow lies on the high ledges
    rock *= rockShade(vWP.xz);   // the clouds' shadows, as on the ground below
    diffuseColor.rgb = rock;
    gH = ((f1.r - 0.5) - f1.g * 1.2) * 0.35 * nearK * k1 + ((f2.r - 0.5) - f2.g * nearK) * 0.9 * midK * k2 + (f3.r - 0.5) * 0.6 * k3 - cav * 0.8;
    gH *= 1.0 - gSnow * 0.8;
  }`;
const CLIFF_BUMP = `/* glsl */
#include <normal_fragment_maps>
  normal = terrainReliefNormal(vViewPosition, normal, gH, 2.2, vec2(40.0, 260.0));`;
// Positions and normals are expressed in the same terrain frame as the sample coordinates.
const STATIC_VERTEX = `attribute vec4 aRock; attribute float aYY;
vec3 cP, cN; float cHide;
void cliffMorph() { cP = position; cN = normal; cHide = 0.0; }`;
const FULL_LIGHT = 'float rockShade(vec2 xz) { return 1.0; }';

export function createStrataMaterial({ texture, palette, snowline = 1e7, shading = FULL_LIGHT, vertex = STATIC_VERTEX, uniforms = {} }) {
  const head = vertex + '\nvarying vec3 vWP, vWN; varying vec4 vRock; varying float vYY;';
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  const colors = {};
  for (const key of ['dark', 'light', 'iron', 'shale', 'dust', 'lichen', 'crust', 'snow']) {
    const rgb = palette[key];
    if (!rgb || rgb.length !== 3 || !rgb.every(Number.isFinite)) throw new TypeError('Expected a linear RGB triple for ' + key);
    colors['u' + key[0].toUpperCase() + key.slice(1)] = { value: new Color(...rgb) };
  }
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms, colors, { uRockTex: { value: texture }, uSnowline: { value: snowline } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + head)
      .replace('#include <beginnormal_vertex>', 'cliffMorph(); vec3 objectNormal = cN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = cP; vWP = cP; vWN = cN; vRock = aRock; vYY = aYY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (cHide > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + shading + '\n' + CLIFF_FRAG_HEAD + '\n' + terrainReliefGLSL)
      .replace('#include <color_fragment>', CLIFF_FRAG)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, gSnow);')
      .replace('#include <normal_fragment_maps>', CLIFF_BUMP);
  };
  m.customProgramCacheKey = () => 'strata:' + vertex + ':' + shading;
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + vertex)
      .replace('#include <begin_vertex>', 'cliffMorph(); vec3 transformed = cP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (cHide > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
  };
  depth.customProgramCacheKey = () => 'strata-depth:' + vertex;
  return { material: m, depth };
}

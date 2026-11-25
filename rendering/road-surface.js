import * as THREE from 'three';

// Packed earth, wheel ruts and rain-dependent puddles on a road strip.
const ROAD_COMMON = `/* glsl */ varying vec4 vRoad; varying vec3 vRW; float gPud = 0.0;
  float rh(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y); }
  varying vec3 vVerge; uniform sampler2D uGrit; uniform float uRoadDamp;`;
const ROAD_SURFACE = `/* glsl */
  float x = vRoad.x, s = vRoad.y, hw = vRoad.z, fine = smoothstep(160.0, 45.0, length(vViewPosition));      // fine grain fades out before it can shimmer
  float nw = mix(0.5, rn(vRW.xz * 1.9), fine), nb = rn(vRW.xz * 0.37), ns = rn(vRW.xz * 0.11 + 7.0);
  float side = x > 0.0 ? 3.1 : 9.4;                                                                          // each edge meanders on its own
  float edge = hw + (rn(vec2(s * 0.018, side + 1.0)) - 0.5) * 1.4 + (rn(vec2(s * 0.06, side)) - 0.5) * 1.2 + (rn(vec2(s * 0.24, side + 2.0)) - 0.5) * 0.5 + (rn(vec2(s * 0.9, side + 4.0)) - 0.5) * 0.3 * fine - abs(x);   // metres inside the travelled edge
  float drift = (rn(vec2(s * 0.02, 1.3)) - 0.5) * 1.3 + (rn(vec2(s * 0.09, 2.3)) - 0.5) * 0.3, gauge = 0.78 + (rn(vec2(s * 0.05, 5.1)) - 0.5) * 0.14;   // the ruts wander as a pair
  float c = x - drift, r1 = c - gauge, r2 = c + gauge, rw = 0.08 + 0.08 * ns, deep = 0.18 + 0.3 * rn(vec2(s * 0.07, 6.6));
  float rut = (exp(-r1 * r1 / rw) + exp(-r2 * r2 / rw)) * smoothstep(-0.3, 0.6, edge);
  float crown = (1.0 - smoothstep(gauge * 0.3, gauge * 0.72, abs(c))) * vRoad.w;
  float grass = clamp(crown * smoothstep(0.38, 0.66, nb * 0.75 + nw * 0.25) + (1.0 - smoothstep(-0.2, 0.9, edge)) * smoothstep(0.42, 0.68, nb) * 0.7, 0.0, 1.0);
  gPud = smoothstep(0.08, 0.45, uRoadDamp) * smoothstep(0.35, 0.8, rut) * smoothstep(0.7, 0.76, rn(vec2(s * 0.16, c * 0.6 + 4.0)) * 0.75 + ns * 0.25) * (1.0 - grass);   // water lies in the deeper stretches of rut
  float worn = smoothstep(-0.2, 0.9, edge);                                                                  // the travelled way, packed and dry, against its damp margin
  float near = smoothstep(70.0, 6.0, length(vViewPosition));                                               // grit, pebbles and dried cracks, at walking distance
  vec3 g1 = texture2D(uGrit, vRW.xz * 0.45).rgb, g2 = texture2D(uGrit, vRW.xz * 0.13 + 0.37).rgb;
  float grit = mix(1.0, (0.72 + 0.56 * g1.r) * (0.86 + 0.28 * g2.r) * (1.0 + 0.28 * g1.g * g2.r * worn) * (1.0 - 0.22 * g1.b * worn * (1.0 - min(rut, 1.0))), near);
  vec3 soil = diffuseColor.rgb * grit * (0.86 + 0.28 * ns) * (0.9 + 0.2 * nw) * mix(0.72, 1.06, worn) * (1.0 - deep * min(rut, 1.0));   // ruts are compacted, wetter and shadowed
  diffuseColor.rgb = mix(soil, vVerge * (0.8 + 0.4 * nw), grass) * (1.0 - 0.45 * gPud);
  diffuseColor.a *= smoothstep(-0.9, 0.5, edge + (nw - 0.5) * 0.8);`;
const ROAD_SHEEN = `/* glsl */
  #if NUM_HEMI_LIGHTS > 0
  if (gPud > 0.0) { float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0); outgoingLight += gPud * fr * hemisphereLights[0].skyColor * 0.6; }
  #endif
  #include <opaque_fragment>`;

export function createRoadMaterial({ grit, dampness = { value: 0 } }) {
  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uGrit = { value: grit };
    sh.uniforms.uRoadDamp = dampness;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 road; attribute vec3 verge; varying vec4 vRoad; varying vec3 vRW, vVerge;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRoad = road; vVerge = verge; vRW = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ROAD_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + ROAD_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.08, gPud);')
      .replace('#include <opaque_fragment>', ROAD_SHEEN);
  };
  mat.customProgramCacheKey = () => 'road-earth';
  return mat;
}

/**
 * Shader materials and vertex attributes for open water and flowing streams.
 * @module
 */

import * as THREE from 'three';
import { FOAM_GLSL, SEA_BODY, SEA_OPACITY, SEA_WAVES } from './sea-shaders.js';
import { RAIN_GLSL, RAIN_PARS } from './rain-rings.js';
import { STREAM_FLOW_GLSL } from './stream-flow.js';
import { DEEP, FAR } from '../geometry/stream.js';

/**
 * Create the open-water material (`waterMat`) and the ribbon material for rivers (`streamMat`).
 * Supply the depth-map transform, still-water elevation, sea parameters and wake shader inputs.
 * The optional cloud shader supplies a shadow factor at a world-space X/Z position.
 */
export function createWaterMaterials({ depthRect, level, seaParameters, wakes, cloudShader = 'float cloudShade(vec2 p) { return 1.0; }', cloudUniforms = {} }) {
  const { WAKE_GLSL, WAKE_PARS, wakeUniforms } = wakes;
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3() },
        uSunCol: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
        uDeep: { value: new THREE.Color() },
        uHasDepth: { value: 1 },
        uGust: { value: 0 }, // how hard a squall's wind blows: it raises the waves
        uLum: { value: 1 },
        uRefl: { value: null },
        uReflM: { value: new THREE.Matrix4() },
        uReflOn: { value: 0 },
        uHarbour: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) },
        uDepthR: { value: depthRect.clone() }, // where the depth map lies: uv = xy + world.xz * zw
        uLevel: { value: level }, // still water, which a stream's ribbon fades into
        uRain: { value: 0 }, // the rain falling where the viewer is, 0 to 1
        uTint: { value: new THREE.Color(1, 1, 1) }, // the water's own colour over the light's (a lake's `tint`: lime-white water is turquoise)
      },
    ]),
    vertexShader: `/* glsl */
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 aCurrent; attribute vec3 aFlow; attribute vec4 aBank;
      varying vec3 vW, vFlow; varying vec2 vCurrent; varying vec4 vBank;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
        vFlow = aFlow; vCurrent = aCurrent; vBank = aBank;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `/* glsl */
      uniform float uTime, uHasDepth, uLum, uReflOn, uGust; uniform vec3 uSunDir, uSunCol, uHorizon, uZenith, uDeep; uniform sampler2D uDepth, uRefl; uniform mat4 uReflM;
      uniform vec4 uHarbour[3], uDepthR; uniform float uLevel; uniform vec3 uTint;
      varying vec3 vW, vFlow; varying vec2 vCurrent; varying vec4 vBank;
      #include <common>
      #include <fog_pars_fragment>
      ${cloudShader}
      ${FOAM_GLSL}
      ${WAKE_PARS}
      ${RAIN_PARS}
      #ifdef STREAM_RIFFLES
      uniform vec2 uStreamSpeed;
      ${STREAM_FLOW_GLSL}
      #endif
      #ifdef SEA
      ${seaParameters}
      #endif
      vec2 wv(vec2 waterPosition, vec2 waveDirection, float frequency, float angularSpeed, float amplitude){
        return waveDirection * (frequency * amplitude * cos(dot(waveDirection, waterPosition) * frequency + uTime * angularSpeed));
      }
      vec2 ripple(vec2 offset, vec2 stretch, float range, float phase) {
        vec2 q = offset * stretch;
        float d = length(q), amp = smoothstep(0.04, 0.45, d) * (1.0 - smoothstep(0.4, range, d));
        return q * stretch * (amp * cos(d * 8.0 - uTime * 3.1 + phase) / max(d, 0.04));
      }
      void main(){
        vec3 V = cameraPosition - vW; float dist = max(length(V), 0.001); V /= dist;
        vec2 depthUv = uDepthR.xy + vW.xz * uDepthR.zw;
        vec3 bed = texture2D(uDepth, depthUv).rgb;
        float dep = mix(vBank.x, bed.r * 10.0 - 2.0, uHasDepth);
        #ifdef SEA
          // past the depth map's edge, whose last row its lookup repeats, the sea's depth is the one its sheet carries at each
          // vertex, over the ground carried out there; and what the map says
          // of its bed (calm water, a shore) is let go there, or a cape's calm shallows ran on past the edge as a band to the horizon
          vec2 pastUv = max(-depthUv, depthUv - 1.0);
          float pastEdge = smoothstep(0.0, 300.0, max(pastUv.x, pastUv.y) / uDepthR.z) * uHasDepth;
          dep = mix(dep, vBank.x, pastEdge);
          bed.gb *= 1.0 - pastEdge;
        #endif
        float waterline = max(dep, 0.0);
        float flow = clamp(length(vCurrent), 0.0, 1.0);
        vec2 p = vW.xz; p += 1.7 * vec2(sin(p.y * 0.071 + uTime * 0.09) + 0.6 * sin(p.y * 0.23 - p.x * 0.11), cos(p.x * 0.063 - uTime * 0.07) + 0.6 * cos(p.x * 0.19 + p.y * 0.13));   // bend the wave trains so they never line up
        // the size of a pixel on the water, along its longer side (at a grazing look, the way the eye looks): waves finer than that
        // are left out, or they shimmer as the eye moves; read from the picture itself, so a smaller picture or a lower look leaves out more
        float fp = max(dist * 0.0016 / max(V.y, 0.04), max(length(dFdx(vW.xz)), length(dFdy(vW.xz))));
        #define OW(f) (1.0 - smoothstep(1.5, 3.6, fp * f))
        vec2 g = wv(p, vec2(0.8,0.6), 0.33, 1.0, 0.24) * OW(0.33) + wv(p, vec2(-0.5,0.866), 0.61, 1.45, 0.13) * OW(0.61)
               + wv(p, vec2(0.2,-0.98), 1.37, 2.2, 0.055) * OW(1.37) + wv(p, vec2(-0.93,-0.36), 2.9, 3.0, 0.024) * OW(2.9)
               + wv(p, vec2(0.6,-0.8), 6.3, 4.4, 0.009) * OW(6.3);
        float nearW = 1.0 / (1.0 + dist * 0.03);
        g += (wv(p, vec2(0.36,0.93), 11.0, 5.6, 0.005) * OW(11.0) + wv(p, vec2(-0.86,0.5), 17.0, 7.1, 0.0032) * OW(17.0) + wv(p, vec2(0.97,-0.24), 27.0, 9.0, 0.002) * OW(27.0) + wv(p, vec2(-0.3,-0.95), 43.0, 12.0, 0.0012) * OW(43.0)) * nearW;
        float gust = sin(p.x * 0.013 + uTime * 0.05) * sin(p.y * 0.017 - uTime * 0.04) + 0.5 * sin(dot(p, vec2(0.031, -0.022)) + uTime * 0.07);
        g *= (0.5 + 0.6 * smoothstep(-0.8, 0.9, gust)) * (1.0 + 1.3 * uGust);      // calm slicks and wind-roughened patches; a squall's wind raises it all
        g *= mix(0.39, 1.0, smoothstep(0.0, 2.9, waterline)) * (1.0 - uHasDepth * bed.b * 0.55);
        float currentFleck = 0.0, rapid = 0.0;
        if (flow > 0.01) {
          vec2 downstream = vCurrent / flow, transverse = vec2(-downstream.y, downstream.x);
          #ifdef STREAM_RIFFLES
          vec4 motion = streamFlow(vFlow, vBank.w, dep, uTime * mix(uStreamSpeed.x, uStreamSpeed.y, vFlow.z), dist, fp);
          g = mix(downstream * motion.y + transverse * motion.x, g, 0.22);
          currentFleck = motion.z;
          rapid = motion.w;
          #else
          float speed = mix(1.4, 4.5, vFlow.z), run = vFlow.y, crossRun = vFlow.x;
          float drift = sin(crossRun * 2.1) * 0.18 + cos(crossRun * 4.1) * 0.1;
          float phase = run * 3.6 - uTime * speed * (2.4 + drift) + sin(crossRun * 2.8 + run * 0.14) * 1.7;
          float moving = run - uTime * speed;
          float crease = moving * 1.15 + cos(crossRun * 9.5 + moving * 0.17) * 1.3;
          float threads = sin(crossRun * 7.5 + cos(moving * 0.43)) * cos(moving * 0.68 + crossRun * 8.1);
          vec2 current = downstream * (0.06 * cos(phase) * OW(3.6) + 0.09 * cos(crease) * OW(1.15))
                       + transverse * (0.052 * threads + 0.055 * cos(phase) * OW(3.6));
          g = mix(current, g, 0.16);
          currentFleck = smoothstep(0.61, 0.99, sin(crease)) * smoothstep(0.35, 0.9, threads) * (0.08 + 0.32 * vFlow.z) * OW(3.6);
          // white water where the bed falls steeply: streaks of foam racing downstream, thickest in the fast middle, with darker
          // tongues of smooth water between them and quieter water along the edges
          float steep = smoothstep(0.28, 0.8, vFlow.z);
          float streak = 0.5 + 0.5 * sin(crossRun * 11.0 + 2.0 * cos(moving * 0.9));
          // the churn's bands wander (their phase bent by slower waves), or from the air they lay across the river as even stripes
          float churn = 0.5 + 0.5 * sin(moving * 2.3 + crossRun * 5.0 + 1.6 * sin(moving * 0.37 + crossRun * 1.9))
                            * cos(moving * 0.7 - crossRun * 3.0 + 0.9 * sin(moving * 0.21 - crossRun * 0.8));
          float banded = smoothstep(0.42, 0.95, streak * 0.55 + churn * 0.7) * mix(0.6, 1.0, OW(2.3));
          // far off, or once the bands are finer than a pixel, the foam is drawn as the share of the water it covers
          float even = max(smoothstep(45.0, 220.0, dist), 1.0 - OW(2.3));
          rapid = steep * mix(banded, 0.38, even) * max(1.0 - 0.5 * crossRun * crossRun, 0.0) * smoothstep(0.3, 1.6, dep);
          #endif
          // a spring: rings spreading from the eye of its pool, where the water wells up
          float eye = length(vBank.zw);
          g += (downstream * vBank.z + transverse * vBank.w) * (exp(-eye * 0.8) * 0.2 * cos(eye * 5.2 - uTime * 3.3) / max(eye, 0.08) * OW(5.2));
        }
        if (uHasDepth > 0.5 && dist < 160.0) {
          vec2 harbourRipples = vec2(0.0);
          for (int i = 0; i < 3; i++) {
            vec4 pier = uHarbour[i]; vec2 d = vec2(cos(pier.w - 10.0), sin(pier.w - 10.0)), r = vW.xz - pier.xy, q = vec2(dot(r, d), d.x * r.y - d.y * r.x);
            if (pier.w < 0.5 || abs(q.y) > 12.0 || q.x < -13.0 || q.x > 41.0) continue;
            float pile = clamp(floor((q.x - 3.0) / 6.0 + 0.5), 0.0, 5.0);
            harbourRipples += ripple(q - vec2(3.0 + 6.0 * pile, sign(q.y) * 1.9), vec2(1.0), 3.8, pile);
            harbourRipples += ripple(q - vec2(6.0, pier.z * 4.2), vec2(0.45, 1.0), 5.5, 1.9);
            harbourRipples += ripple(q - vec2(21.0, -pier.z * 3.6), vec2(0.6, 1.0), 4.5, 3.6);
          }
          g += harbourRipples * 0.19 * OW(8.0);
        }
        #ifdef SEA
        ${SEA_WAVES}
        #endif
        ${WAKE_GLSL}
        ${RAIN_GLSL}
        float fade = 1.0 / (1.0 + dist * 0.011);
        vec3 N = normalize(vec3(-g.x * fade, 1.0, -g.y * fade));
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = mix(uHorizon, uZenith, pow(R.y, 0.5));
        if (uReflOn > 0.01) {                                    // the mirrored view of shore, city and sky, bent by the waves
          vec4 rc = uReflM * vec4(vW, 1.0);
          if (rc.w > 0.0001) {
            // far off and at a grazing look the waves average out and the shore's thin band of reflection must stay where it is
            float bend = clamp(V.y * 4.0, 0.15, 1.0) / (1.0 + dist * 0.02);
            vec3 rf = texture2D(uRefl, clamp(rc.xy / rc.w + N.xz * vec2(0.12, 0.2) * bend, 0.003, 0.997)).rgb;
            if (rf.r >= 0.0 && rf.g >= 0.0 && rf.b >= 0.0) sky = mix(sky, min(rf, vec3(24.0)), uReflOn);
          }
        }
        float rs = max(dot(R, uSunDir), 0.0);
        float lap = dep + 0.17 * sin(uTime * 1.25 + p.x * 0.29 + p.y * 0.21);
        float breaks = sin(p.x * 0.53 + p.y * 0.73 - uTime * 1.15) * sin(p.y * 0.94 - p.x * 0.32) + 0.33 * gust;
        float foam = uHasDepth * smoothstep(0.06, 0.22, lap) * (1.0 - smoothstep(0.27, 0.64, lap))
                   * smoothstep(0.24, 0.74, breaks) * bed.g * (1.0 - bed.b * 0.85) * OW(2.9);
        #ifdef SEA
        foam = 0.0;                                              // the sea's white water is its own (rapid)
        #endif
        float shallow = 1.0 - smoothstep(0.0, 4.2, waterline);
        vec3 silt = mix(vec3(0.045, 0.057, 0.030), vec3(0.043, 0.103, 0.082), bed.g);
        vec3 body = mix(uDeep, silt * uLum + uDeep * 0.60, shallow);
        body = mix(body, vec3(0.064, 0.084, 0.069) * uLum, flow * 0.82 * (1.0 - smoothstep(1.5, 6.0, waterline)));   // running water is clouded by what it carries, but a channel's deep middle takes the depth's colour as still water does: a river was one flat grey-green beside the lake it ran into
        #ifdef SEA
        ${SEA_BODY}
        #endif
        body *= uTint;
        float lit = cloudShade(vW.xz);      // under a cloud the water lies darker, and the sun's glitter all but goes out
        body *= lit;
        float far = max(smoothstep(30.0, 700.0, dist), smoothstep(0.02, 0.5, fp));
        vec3 col = mix(body, sky, fres) + uSunCol * (lit * lit * lit) * (pow(rs, mix(900.0, 70.0, far)) * mix(10.0, 1.3, far) + pow(rs, 14.0) * 0.12) + vec3(0.58, 0.66, 0.61) * (foam * 0.47 + currentFleck * 0.47) * uLum;
        col = mix(col, vec3(0.78, 0.84, 0.82) * uLum, rapid * 0.86);
        float opacity = mix(0.16, 0.92, 1.0 - exp(-waterline * 0.51 / max(V.y, 0.32)));
        #ifdef SEA
        ${SEA_OPACITY}
        #endif
        float edge = mix(1.0, smoothstep(-0.11, 0.21, dep), uHasDepth);
        #ifdef SEA
        // the sea's sheet lies under the whole land: where the map's A says the water over the bed is a lake's, only the lake's own
        // sheet is drawn, or a pit's lake whose bed sinks below the sea showed the sea's level through it as a patch
        if (vW.y < uLevel + 0.5) edge *= texture2D(uDepth, depthUv).a;
        #endif
        float riverEdge = vBank.y * smoothstep(0.1, 1.0, vBank.x) * mix(1.0, 0.83, flow * shallow);   // a ribbon thins out over its banks and at its head, and its running shallows show their bed
        float riverMouth = 1.0 - flow * (1.0 - smoothstep(uLevel + 0.02, uLevel + 0.5, vW.y)) * smoothstep(2.15, 2.8, bed.r * 10.0);
        gl_FragColor = vec4(col, mix(opacity, 1.0, max(max(fres, foam * 0.45), rapid)) * edge * riverEdge * riverMouth);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(waterMat.uniforms, wakeUniforms, cloudUniforms); // after the merge, which would copy them: shared, not copied
  const streamMat = waterMat.clone(); // streams and open sea: no bed to read
  Object.assign(streamMat.uniforms, wakeUniforms, cloudUniforms);
  streamMat.uniforms.uHasDepth.value = 0;
  streamMat.uniforms.uRefl = { value: null };
  for (const material of [waterMat, streamMat]) stillByDefault(material);
  return { waterMat, streamMat };
}
// Preserve the live lighting, clock and wake uniforms when specializing a water material.
function waterVariant(material) {
  const variant = material.clone();
  Object.assign(variant.defaultAttributeValues, material.defaultAttributeValues);
  Object.assign(variant.uniforms, material.uniforms);
  return variant;
}

/** Create a variant with its own linear RGB tint. Lighting, wave and wake uniforms stay linked to the original. */
export function tintedWater(material, tint) {
  const variant = waterVariant(material);
  variant.uniforms.uTint = { value: new THREE.Color(...tint) };
  return variant;
}

// Speeds are metres per second on level and steep reaches, respectively.
export function rippledStream(material, { speed, rapidSpeed = speed }) {
  const variant = waterVariant(material);
  variant.defines = { ...variant.defines, STREAM_RIFFLES: '' };
  variant.uniforms.uStreamSpeed = { value: new THREE.Vector2(speed, rapidSpeed) };
  return variant;
}
// A sheet of open water has no current, banks or spring of its own.
function stillByDefault(material) {
  material.defaultAttributeValues.aCurrent = [0, 0];
  material.defaultAttributeValues.aFlow = [0, 0, 0];
  material.defaultAttributeValues.aBank = [DEEP, 1, FAR, FAR];
}
// A sheet of open water that shows only in part: at each of its vertices, shareAt(x, z) of it (0 to 1, x and z its own).
export function partSheet(geometry, shareAt) {
  const pos = geometry.attributes.position,
    bank = new Float32Array(pos.count * 4);
  for (let v = 0; v < pos.count; v++) bank.set([DEEP, shareAt(pos.getX(v), pos.getZ(v)), FAR, FAR], v * 4);
  geometry.setAttribute('aBank', new THREE.BufferAttribute(bank, 4));
  return geometry;
}
// A sheet of open water that knows the depth of the bed under each of its vertices past its depth map (depthAt(index), in
// metres, or null where the map tells it).
export function sheetDepths(geometry, depthAt) {
  const count = geometry.attributes.position.count,
    bank = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) bank.set([depthAt(v) ?? DEEP, 1, FAR, FAR], v * 4);
  geometry.setAttribute('aBank', new THREE.BufferAttribute(bank, 4));
  return geometry;
}
const SHARED = [
  'uTime',
  'uSunDir',
  'uSunCol',
  'uHorizon',
  'uZenith',
  'uLum',
  'uDeep',
  'uGust',
  'uCloudField',
  'uCloudSh',
  'uWake',
  'uWakeS',
  'uRain',
];
export function landWater(waterMat, depth, rect, level, sea = null) {
  const make = (hasDepth, own) => {
    const variant = waterMat.clone();
    for (const uniformName of SHARED) if (waterMat.uniforms[uniformName]) variant.uniforms[uniformName] = waterMat.uniforms[uniformName];
    variant.uniforms.uDepth = { value: depth };
    variant.uniforms.uDepthR.value.copy(rect);
    variant.uniforms.uLevel.value = level;
    variant.uniforms.uHasDepth.value = hasDepth;
    variant.uniforms.uRefl = { value: null };
    if (own) {
      Object.assign(variant.uniforms, own);
      variant.defines = { SEA: '' };
    }
    stillByDefault(variant);
    return variant;
  };
  return { open: make(1, sea), stream: make(0) };
}


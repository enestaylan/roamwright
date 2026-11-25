import * as THREE from 'three';

let active = false;
// Install before compiling fog-enabled materials. Fog uniforms share one typed array per Three.js runtime.
export function installHeightHaze({
  sunLobe: SUN_LOBE = 6,
  rimStart: RIM_FROM = 0.62,
  rimGain: RIM_PAST = 12,
  rimEnd: RIM_RAMP = 1.25,
  rimDensity: RIM_HAZE = 0.0008,
} = {}) {
  if (active) throw new Error('Height haze is already installed on this Three.js instance');
  const hazeData = new Float32Array(20);
  const hazeUniform = { value: hazeData };
  const originals = new Map();
  function installUniform(uniforms) {
    originals.set(uniforms, uniforms.uHaze);
    uniforms.uHaze = hazeUniform;
  }
  installUniform(THREE.UniformsLib.fog);
  for (const library of Object.values(THREE.ShaderLib)) {
    if (library.uniforms.fogColor && !originals.has(library.uniforms)) installUniform(library.uniforms);
  }
  const chunks = {};
  chunks.fog_pars_vertex = `/* glsl */
  #ifdef USE_FOG
    varying float vFogDepth; varying vec3 vFogTo;
  #endif`;
  // vFogTo: from the eye to the point, in the world's axes
  chunks.fog_vertex = `/* glsl */
  #ifdef USE_FOG
    vFogDepth = -mvPosition.z;
    vFogTo = mvPosition.xyz * mat3(viewMatrix);
  #endif`;
  chunks.fog_pars_fragment = `/* glsl */
  #ifdef USE_FOG
    uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogTo;
    #ifdef FOG_EXP2
      uniform float fogDensity; uniform vec4 uHaze[5];
      // the haze below a height, counted from where it lies: all of it below that, thinning above
      float hazeBelow(float y, float fall) { return y < 0.0 ? y : (1.0 - exp(-y * fall)) / fall; }
    #else
      uniform float fogNear; uniform float fogFar;
    #endif
  #endif`;
  chunks.fog_fragment = `/* glsl */
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogReach = length(vFogTo), fogEye = cameraPosition.y - uHaze[0].w, fogRise = vFogTo.y;
      // the share of the ground's haze that lies along the line of sight: its mean between the eye's height and the point's
      float fogThin = abs(fogRise) > 0.5 ? (hazeBelow(fogEye + fogRise, uHaze[1].w) - hazeBelow(fogEye, uHaze[1].w)) / fogRise : exp(-max(fogEye, 0.0) * uHaze[1].w);
      // towards a land's edge (1) the haze over the ground closes in, and past it thicker still along the part of the line of sight
      // that lies past it (as a share of the way from the eye to the point, where the edge is crossed): counted over the whole line, a
      // point just past the edge was hidden far more than one just inside, and seen along the edge it stood as an upright band of haze.
      // The edge is a square with its corners rounded.
      vec2 fogOut = abs(cameraPosition.xz + vFogTo.xz - uHaze[3].xy) * uHaze[3].z, fogEyeOut = abs(cameraPosition.xz - uHaze[3].xy) * uHaze[3].z;
      float fogEdge = sqrt(length(fogOut * fogOut)), fogEyeEdge = sqrt(length(fogEyeOut * fogEyeOut));
      float fogPast = clamp((fogEdge - max(fogEyeEdge, 1.0)) / max(fogEdge - fogEyeEdge, 1e-4), 0.0, 1.0);
      float fogRim = smoothstep(${RIM_FROM}, 1.0, fogEdge) + ${RIM_PAST.toFixed(1)} * fogPast * smoothstep(1.0, ${RIM_RAMP}, fogEdge);
      // far above the ground a share of the haze is left (uHaze[4].w); what lies near the ground may be thicker than the air's own (uHaze[2].w: a mist on the land at dawn)
      float fogD = fogReach * (fogDensity * (uHaze[4].w + (1.0 - uHaze[4].w) * fogThin * uHaze[2].w) + uHaze[3].w * fogRim * exp(-max(fogEye + fogRise, 0.0) * uHaze[1].w));
      // mist on the water: a second, shallow layer, thick enough to hide a far shore from the water and thin from above
      float fogLow = 0.0;
      if (uHaze[4].z > 0.0) {
        float mistEye = cameraPosition.y - uHaze[4].x;
        fogLow = uHaze[4].z * fogReach * (abs(fogRise) > 0.5 ? (hazeBelow(mistEye + fogRise, uHaze[4].y) - hazeBelow(mistEye, uHaze[4].y)) / fogRise : exp(-max(mistEye, 0.0) * uHaze[4].y));
      }
      float fogFactor = 1.0 - exp(-fogD * fogD - fogLow);
      float fogSun = dot(vFogTo, uHaze[0].xyz) / max(fogReach, 0.001), fogSide = fogSun * 0.5 + 0.5;
      vec3 fogHue = mix(uHaze[1].rgb, fogColor, fogSide * fogSide);
      fogHue = mix(fogHue, uHaze[2].rgb, pow(max(fogSun, 0.0), ${SUN_LOBE.toFixed(1)}));
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      vec3 fogHue = fogColor;
    #endif
    #ifdef FOG_FADES
      gl_FragColor.rgb *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogHue, fogFactor);
    #endif
  #endif`;
  const originalChunks = {};
  for (const [key, chunk] of Object.entries(chunks)) {
    originalChunks[key] = THREE.ShaderChunk[key];
    THREE.ShaderChunk[key] = chunk;
  }
  active = true;
  function setHaze(sun, base, kind, away, sunward, low, x, z, edge) {
    hazeData[0] = sun.x;
    hazeData[1] = sun.y;
    hazeData[2] = sun.z;
    hazeData[3] = base;
    hazeData[4] = away.r;
    hazeData[5] = away.g;
    hazeData[6] = away.b;
    hazeData[7] = kind.fall;
    hazeData[8] = sunward.r;
    hazeData[9] = sunward.g;
    hazeData[10] = sunward.b;
    hazeData[11] = low;
    hazeData[19] = kind.floor;
    hazeData[12] = x;
    hazeData[13] = z;
    hazeData[14] = edge ? 1 / edge : 0;
    hazeData[15] = edge ? RIM_HAZE : 0;
  }

  // Each frame: the mist on a land's water: the height it lies on, the metres it thins in, and its density (0: none).
  function setMist(level, depth, thick) {
    hazeData[16] = level;
    hazeData[17] = 1 / depth;
    hazeData[18] = thick;
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [uniforms, previous] of originals) {
      if (uniforms.uHaze !== hazeUniform) continue;
      if (previous === undefined) delete uniforms.uHaze;
      else uniforms.uHaze = previous;
    }
    for (const key of Object.keys(chunks)) {
      if (THREE.ShaderChunk[key] === chunks[key]) THREE.ShaderChunk[key] = originalChunks[key];
    }
    active = false;
  }
  return { setHaze, setMist, dispose };
}

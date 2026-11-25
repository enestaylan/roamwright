import * as THREE from 'three';

// Positions are local XYZ triples. Supply shared uniforms for animated intensity, time
// and the perspective pixel scale so all batches follow one camera and exposure.
export function createLightPoints({
  positions, seeds, color, intensity, pointScale, time = { value: 0 },
  emitterDiameter, haloDiameter, minPixels = 3.5, daytime = 0, variation = 0,
  distantGain = 1, fadeIn, fadeOut,
}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (seeds) geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: color }, uIntensity: intensity, uTime: time, uScale: pointScale,
      ...(fadeIn && { uFadeIn: { value: new THREE.Vector2(...fadeIn) } }),
      ...(fadeOut && { uFadeOut: { value: new THREE.Vector2(...fadeOut) } }),
    },
    vertexShader: `uniform float uIntensity, uTime, uScale;
      ${seeds ? 'attribute float aSeed;' : ''}
      ${fadeIn ? 'uniform vec2 uFadeIn;' : ''}
      ${fadeOut ? 'uniform vec2 uFadeOut;' : ''}
      varying float vStrength, vCore, vRadius;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float depth = -mv.z;
        float emitter = uScale * ${emitterDiameter.toFixed(6)} / depth;
        gl_PointSize = clamp(uScale * ${haloDiameter.toFixed(6)} / depth, ${minPixels.toFixed(6)}, 240.0);
        vCore = 1.0 - smoothstep(1.5, 4.0, emitter);
        vRadius = max(emitter, 1.2) / gl_PointSize;
        float modulation = ${seeds ? `${(1 - variation).toFixed(6)} + ${variation.toFixed(6)} * sin(uTime * (6.0 + aSeed * 7.0) + aSeed * 50.0)` : '1.0'};
        vStrength = (${daytime.toFixed(6)} + ${(1 - daytime).toFixed(6)} * uIntensity) * modulation * mix(1.0, ${distantGain.toFixed(6)}, smoothstep(200.0, 900.0, depth));
        ${fadeIn ? 'vStrength *= smoothstep(uFadeIn.x, uFadeIn.y, length(mv.xyz));' : ''}
        ${fadeOut ? 'vStrength *= 1.0 - smoothstep(uFadeOut.x, uFadeOut.y, length(mv.xyz));' : ''}
      }`,
    fragmentShader: `uniform vec3 uColor;
      varying float vStrength, vCore, vRadius;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float halo = exp(-r*r*14.0)*0.62 + exp(-r*r*3.2)*0.16;
        float core = exp(-pow(r/vRadius, 2.0)*2.0)*5.0*vCore;
        gl_FragColor = vec4((uColor*halo + mix(uColor, vec3(1.0), 0.45)*core) * vStrength * (1.0 - smoothstep(0.85, 1.0, r)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Points(geometry, material);
}

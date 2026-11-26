import * as THREE from 'three';

// One camera-centred instanced draw. The shared wind velocity tilts the streaks,
// while its accumulated displacement carries them smoothly through changes of wind.
export function createRainStreaks({ capacity, windUniforms, random = Math.random }) {
  if (!(Number.isSafeInteger(capacity) && capacity > 0)) throw new RangeError('Rain capacity must be a positive integer');
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  {
    const off = new Float32Array(capacity * 4);
    for (let i = 0; i < off.length; i++) off[i] = random();
    geometry.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  }
  geometry.instanceCount = capacity;
  const rainU = {
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uCol: { value: new THREE.Color() },
    uWind: windUniforms.uWind,
    uWindDrift: windUniforms.uWindDrift,
  };
  const rainMat = new THREE.ShaderMaterial({
    uniforms: rainU,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      uniform vec3 uCam; uniform float uTime, uRain; uniform vec3 uWind; uniform vec2 uWindDrift;
      attribute vec4 aOff; varying float vA; varying vec2 vUv;
      const vec3 B = vec3(52.0, 28.0, 52.0);                        // the box of falling rain round the eye, in metres
      void main(){
        float speed = 8.0 + 2.5 * aOff.w;
        vec3 fall = vec3(uWind.x, -speed, uWind.y);
        vec3 rel = mod(aOff.xyz * B + vec3(uWindDrift.x, -speed * uTime, uWindDrift.y) - uCam + B * 0.5, B) - B * 0.5;     // where this drop is now, wrapped round the eye
        vec3 c = uCam + rel, dir = normalize(fall);
        vec3 side = normalize(cross(dir, normalize(-rel + vec3(0.0, 0.0, 0.001))));
        float d = length(rel);
        vec3 wp = c + side * position.x * (0.009 + d * 0.0006) + dir * position.y * (0.5 + 0.3 * aOff.w);
        vA = step(fract(aOff.w * 7.31), uRain * 1.05) * (1.0 - smoothstep(14.0, 26.0, length(rel.xz))) * (1.0 - smoothstep(9.0, 13.5, abs(rel.y))) * smoothstep(0.5, 2.0, d);
        vUv = position.xy + vec2(0.5, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; varying float vA; varying vec2 vUv;
      void main(){
        float a = vA * (1.0 - abs(vUv.x * 2.0 - 1.0)) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
        if (a < 0.003) discard;
        gl_FragColor = vec4(uCol, a * 0.34);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, rainMat);
  mesh.frustumCulled = false;
  mesh.visible = false;

  // Camera position in world space, elapsed seconds, shower intensity and fraction of capacity.
  function update(eye, seconds, intensity, density = 1) {
    geometry.instanceCount = Math.round(capacity * THREE.MathUtils.clamp(density, 0, 1));
    mesh.visible = intensity > 0 && geometry.instanceCount > 0;
    if (!mesh.visible) return;
    rainU.uCam.value.copy(eye);
    rainU.uTime.value = seconds;
    rainU.uRain.value = intensity;
  }
  return { mesh, color: rainU.uCol.value, update };
}

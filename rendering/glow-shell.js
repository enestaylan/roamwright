import * as THREE from 'three';

const LEAST_HEIGHT = 0.6, // metres: a line nearer the foot than this hangs no sheet (a ring at the foot itself)
  PULL = 0.06; // metres each sheet is drawn towards the viewer, so the wall it lies on never hides it

const VERTEX = /* glsl */ `
attribute vec3 side;
varying vec3 vSide, vTo;
varying float vUp;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vUp = uv.y;
  vSide = normalize(mat3(modelMatrix) * side);
  vTo = cameraPosition - w.xyz;
  vec4 mvPosition = viewMatrix * w;
  mvPosition.xyz *= 1.0 - ${PULL.toFixed(2)} / max(length(mvPosition.xyz), 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity, wash, rim;
varying vec3 vSide, vTo;
varying float vUp;
#include <fog_pars_fragment>
void main() {
  float facing = abs(dot(vSide, normalize(vTo))), edge = 1.0 - facing;
  float light = (wash + rim * edge * edge * edge) * smoothstep(0.0, 0.35, vUp) * (0.8 + 0.2 * vUp);
  gl_FragColor = vec4(color * opacity * light, 1.0);
  #include <fog_fragment>
}`;

// A mesh of glowing sheets hung from `segments` (a flat list [ax, ay, az, bx, by, bz, ...] in its parent's frame) down to
// footAt(x, z), the height of the building's foot under each end. Its material's uniforms are set by its owner: color, opacity, and how much of it is wash and how much rim.
function glowShell(segments, footAt, color) {
  const position = [],
    side = [],
    uv = [];
  for (let i = 0; i < segments.length; i += 6) {
    const [ax, ay, az, bx, by, bz] = segments.slice(i, i + 6),
      len = Math.hypot(bx - ax, bz - az),
      fa = footAt(ax, az),
      fb = footAt(bx, bz);
    if (Math.min(ay - fa, by - fb) < LEAST_HEIGHT || len < 0.01) continue;
    const nx = -(bz - az) / len,
      nz = (bx - ax) / len,
      // two triangles: the top edge along the line, the bottom at the foot
      corners = [
        [ax, ay, az, 1],
        [bx, by, bz, 1],
        [bx, fb, bz, 0],
        [ax, ay, az, 1],
        [bx, fb, bz, 0],
        [ax, fa, az, 0],
      ];
    for (const [x, y, z, up] of corners) {
      position.push(x, y, z);
      side.push(nx, 0, nz);
      uv.push(0, up);
    }
  }
  if (!position.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      color: { value: new THREE.Color(color) },
      opacity: { value: 1 },
      wash: { value: 0.1 },
      rim: { value: 0.6 },
    },
    defines: { FOG_FADES: '' }, // Applications can use this define to attenuate additive fog.
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  return new THREE.Mesh(geometry, material);
}

export { glowShell };

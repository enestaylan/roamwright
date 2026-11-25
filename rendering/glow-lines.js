import * as THREE from 'three';

const PULL = [0.25, 0.004]; // how far each end is drawn towards the viewer: metres, and a share of its distance

const VERTEX = /* glsl */ `
attribute vec3 from;
attribute vec3 to;
uniform vec2 screen;
uniform float width;
varying float across;
vec4 seen(vec3 p) {
  vec4 v = modelViewMatrix * vec4(p, 1.0);
  float far = length(v.xyz);
  v.xyz -= v.xyz / far * (${PULL[0].toFixed(3)} + ${PULL[1].toFixed(4)} * far);
  return projectionMatrix * v;
}
void main() {
  vec4 a = seen(from), b = seen(to);
  across = position.y;
  if (a.w <= 0.0 || b.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // an end behind the viewer: the segment is not drawn
    return;
  }
  vec2 halfScreen = 0.5 * screen,
    sa = a.xy / a.w * halfScreen,
    sb = b.xy / b.w * halfScreen,
    along = normalize(sb - sa + vec2(1e-5, 0.0)),
    side = vec2(-along.y, along.x);
  vec4 p = mix(a, b, position.x);
  p.xy += (side * position.y + along * (position.x * 2.0 - 1.0)) * width / halfScreen * p.w;
  gl_Position = p;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
varying float across;
void main() {
  gl_FragColor = vec4(color * opacity * exp(-4.0 * across * across), 1.0);
}`;

// A mesh of glowing lines along `segments`, a flat list [ax, ay, az, bx, by, bz, ...] in its parent's frame. Its material's
// uniforms are set by its owner: screen (the picture's size in pixels), width (pixels from the line's middle to where its
// light has gone), color and opacity.
function glowLines(segments, color) {
  const count = segments.length / 6,
    quad = new THREE.InstancedBufferGeometry(),
    ends = new Float32Array(segments);
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const shared = new THREE.InstancedInterleavedBuffer(ends, 6, 1);
  quad.setAttribute('from', new THREE.InterleavedBufferAttribute(shared, 3, 0));
  quad.setAttribute('to', new THREE.InterleavedBufferAttribute(shared, 3, 3));
  quad.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      screen: { value: new THREE.Vector2(1, 1) },
      width: { value: 3 },
      color: { value: new THREE.Color(color) },
      opacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(quad, material);
  mesh.frustumCulled = false; // its quads are placed by the shader; there are few of them
  return mesh;
}

export { glowLines };

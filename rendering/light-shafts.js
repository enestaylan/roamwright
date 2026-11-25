import * as THREE from 'three';

export function createLightShafts({
  camera, ground, heightProbe, time, night,
  defaultHeight: HEIGHT = 22, upperClearance: OVER = 7, probeRadius: REACH = 11,
  maxHeight: TALLEST = 95, probeDistance: MEASURE_NEAR = 450, growthRate: GROW = 1.6,
  rimDistances: RIM_REACH = [90, 160, 240, 320], rimClearance: RIM_OVER = 18,
  bearings: AROUND = 16, rimQuantile: ENCLOSED = 0.25, widenAt: WIDEN_FROM = 70,
}) {
  const geometry = new THREE.CylinderGeometry(0.35, 0.8, 1, 14, 1, true).translate(0, 0.5, 0),
    materials = new Map(); // one material for each colour, which every shaft of that colour shares
  const shafts = [], // every shaft whose height is still to be found or reached
    _from = new THREE.Vector3();
  let measuring = false;

  // The shared look: bright at the foot, fading up the pillar with a slow ripple; it fades as it is walked up to (from inside,
  // looking up, it was a white wedge across the picture), thins with distance and dims at night, so it never owns the skyline.
  function shaftMaterial(color) {
    const key = color.getHexString();
    if (!materials.has(key))
      materials.set(
        key,
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
          uniforms: { uCol: { value: color.clone() }, uTime: time, uNight: night },
          // vAxis: how far the viewer stands from the pillar's foot, on the ground
          vertexShader: /* glsl */ `varying vec2 vUv; varying float vD, vAxis;
        void main(){ vUv = uv;
          float wide = max(1.0, length((modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz) / ${WIDEN_FROM.toFixed(1)});
          vec4 mv = modelViewMatrix * vec4(position.x * wide, position.y, position.z * wide, 1.0); vD = length(mv.xyz);
          vAxis = distance(cameraPosition.xz, modelMatrix[3].xz); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: /* glsl */ `uniform vec3 uCol; uniform float uTime, uNight; varying vec2 vUv; varying float vD, vAxis;
        void main(){ float a = pow(1.0 - vUv.y, 1.25) * (0.55 + 0.45 * sin(vUv.y * 16.0 - uTime * 2.6 + vUv.x * 6.283));
          a *= smoothstep(5.0, 20.0, vD) * smoothstep(3.0, 14.0, vAxis) * mix(1.0, 0.85, smoothstep(60.0, 420.0, vD)) * 0.7 * (1.0 - 0.45 * uNight);
          gl_FragColor = vec4(uCol * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        }),
      );
    return materials.get(key);
  }

  // A shaft of `color` (a THREE.Color, its parts may pass 1) with its foot at the origin of its parent. Under a roof it is
  // `under` metres tall and stays so; under the open sky, where its foot stands at (x, y, z) in the world, it finds its height.
  function lightShaft(color, under = null) {
    const mesh = new THREE.Mesh(geometry, shaftMaterial(color));
    mesh.scale.y = under ?? HEIGHT;
    if (under === null) shafts.push({ mesh, want: HEIGHT, found: false, rim: -1 });
    return mesh;
  }

  // Each frame: finds the height of the nearest shaft not yet measured within reach, and eases every shaft to its height.
  const _rims = new Float32Array(AROUND);
  // How high the ground stands round (x, z) on nearly every side, in metres over y; 0 where it is open on a side or more.
  function enclosedRise(x, y, z) {
    for (let i = 0; i < AROUND; i++) {
      const a = (i / AROUND) * Math.PI * 2;
      let top = -Infinity;
      for (let j = 0; j < RIM_REACH.length; j++)
        top = Math.max(top, ground(x + Math.cos(a) * RIM_REACH[j], z + Math.sin(a) * RIM_REACH[j]));
      _rims[i] = top - y;
    }
    _rims.sort();
    return Math.max(0, _rims[Math.floor(AROUND * ENCLOSED)]);
  }
  // The rise over a pit's rim needs only the ground, so it is found for every shaft however far, one a frame, before the
  // visitor is near enough for the rest of its height to be measured: a shaft in an enclosed basin stands over the rim from afar.
  function findRim() {
    for (let i = 0; i < shafts.length; i++) {
      const s = shafts[i];
      if (s.rim >= 0 || !s.mesh.parent || !isShown(s.mesh)) continue;
      s.mesh.getWorldPosition(_from);
      const rim = enclosedRise(_from.x, _from.y, _from.z);
      s.rim = rim > 0 ? Math.min(TALLEST, rim + RIM_OVER) : 0;
      s.want = Math.max(s.want, s.rim);
      return;
    }
  }
  function updateShafts(dt) {
    findRim();
    let next = null,
      best = MEASURE_NEAR * MEASURE_NEAR;
    for (let i = shafts.length - 1; i >= 0; i--) {
      const s = shafts[i],
        m = s.mesh;
      if (s.found) {
        m.scale.y += (s.want - m.scale.y) * Math.min(1, GROW * dt);
        if (Math.abs(s.want - m.scale.y) < 0.05) {
          m.scale.y = s.want;
          shafts[i] = shafts[shafts.length - 1];
          shafts.pop();
        }
        continue;
      }
      if (s.want > m.scale.y) m.scale.y += (s.want - m.scale.y) * Math.min(1, GROW * dt); // up to its rim's height meanwhile
      if (measuring || !m.parent || !isShown(m)) continue;
      m.getWorldPosition(_from);
      const d = _from.distanceToSquared(camera.position);
      if (d < best) {
        best = d;
        next = s;
      }
    }
    if (!next) return;
    measuring = true;
    next.mesh.getWorldPosition(_from);
    const { x, y, z } = _from;
    heightProbe(x, y, z, REACH)
      .then(top => {
        next.want = Math.min(TALLEST, Math.max(HEIGHT, top - y + OVER, next.rim));
        next.found = true;
      })
      .catch(() => (next.found = true)) // a page that cannot read the picture back keeps the shafts at their own height
      .finally(() => (measuring = false));
  }

  return { lightShaft, shaftMaterial, updateShafts };
}

// Whether a mesh and all that holds it are shown
function isShown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}


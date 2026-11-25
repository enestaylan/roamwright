import * as THREE from 'three';
import { terrainReliefGLSL, terrainRockGLSL } from 'roamwright/rendering/terrain-rock.js';
import { talusGLSL } from 'roamwright/rendering/talus.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(32, 32);
  const pixels = new Uint8Array(32 * 32 * 4);
  let state = 5;
  for (let i = 0; i < pixels.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    pixels[i] = state >>> 24;
  }
  const grain = new THREE.DataTexture(pixels, 32, 32);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    uniforms: { grain: { value: grain }, faceNormal: { value: new THREE.Vector3() } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D grain; uniform vec3 faceNormal; varying vec2 vUv;
      ${terrainRockGLSL}
      ${terrainReliefGLSL}
      ${talusGLSL}
      void main() {
        vec3 p = vec3(21003., 41., -17907.) + (vUv.x - 0.5) * 6. * vec3(-faceNormal.z, 0., faceNormal.x) + vec3(0., vUv.y * 6., 0.);
        vec4 rock = terrainRock(grain, p, faceNormal, vec3(0.3), vec3(0.6), vec3(0.4), vec3(0.7));
        vec3 n = terrainReliefNormal(vec3(vUv - 0.5, 1.), vec3(0., 0., 1.), rock.a, 2., vec2(8., 46.));
        vec2 metres = vUv * 2.;
        vec2 dx = dFdx(metres), dy = dFdy(metres);
        float debris = 0.;
        if (vUv.x > 0.25) debris = talusFragment(metres, dx, dy, 0.5, 0.14).y;
        gl_FragColor = vec4(rock.r, debris, n.z, 1.);
      }`,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  renderer.setRenderTarget(target);
  try {
    for (const [nx, nz] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      material.uniforms.faceNormal.value.set(nx, 0, nz).normalize();
      renderer.render(scene, new THREE.Camera());
      renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
      // A collapsed projection leaves the several metres across the middle of a face nearly one colour.
      if (!pixels.some((v, i) => i % 4 === 1 && v > 50)) throw Error('No talus fragments');
      const row = Array.from({ length: 32 }, (_, x) => pixels[(16 * 32 + x) * 4]);
      if (Math.max(...row) - Math.min(...row) < 15 || !pixels.some((v, i) => i % 4 === 2 && v > 0 && v < 254))
        throw Error('Unresolved rock or relief at face ' + [nx, nz]);
    }
    return 'PASS resolved ground grain and relief on axial and diagonal faces at a distant origin';
  } finally {
    renderer.dispose(); target.dispose(); grain.dispose(); geometry.dispose(); material.dispose();
  }
}

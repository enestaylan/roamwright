import * as THREE from 'three';
import { createStrataMaterial } from 'roamwright/rendering/strata-material.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(32, 32);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.z = 3;
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.setAttribute('aRock', new THREE.Float32BufferAttribute(Array(4).fill([0.5, 1, 0, 1]).flat(), 4));
  geometry.setAttribute('aYY', new THREE.Float32BufferAttribute([1, 1, 0, 0], 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array(12).fill(0.5), 3));
  const texture = new THREE.DataTexture(new Uint8Array([128, 0, 64, 255]), 1, 1);
  texture.needsUpdate = true;
  const gray = [0.5, 0.5, 0.5], palette = Object.fromEntries(['dark','light','iron','shale','dust','lichen','crust','snow'].map(key => [key, gray]));
  const { material, depth } = createStrataMaterial({ texture, palette });
  const shaded = createStrataMaterial({ texture, palette, shading: 'float rockShade(vec2 p) { return 0.2; }' });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh, new THREE.AmbientLight(0xffffff, 2));
  renderer.setRenderTarget(target);
  const sample = mat => {
    mesh.material = mat;
    renderer.render(scene, camera);
    if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 2) throw Error('Unexpected rock draw counts');
    const bytes = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, 16, 16, 1, 1, bytes);
    return bytes[0];
  };
  try {
    const sun = sample(material), shade = sample(shaded.material);
    if (!(sun > shade + 10 && shade > 0)) throw Error('Shading hook or texture failed: ' + [sun, shade]);
    sample(depth);
    return 'PASS rock shading, custom shade, depth and draw counts';
  } finally {
    material.dispose(); depth.dispose(); shaded.material.dispose(); shaded.depth.dispose();
    geometry.dispose(); texture.dispose(); target.dispose(); renderer.dispose();
  }
}

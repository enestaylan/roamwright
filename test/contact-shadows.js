import * as THREE from 'three';
import { ContactShadows } from 'roamwright/rendering/contact-shadows.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(65, 65);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  camera.position.set(0, 4, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const batch = new ContactShadows({ capacity: 1, opacity: 0.5 });
  scene.add(batch.mesh);
  renderer.setRenderTarget(target);
  const pixel = new Uint8Array(4);
  function sample(x) {
    renderer.readRenderTargetPixels(target, x, 32, 1, 1, pixel);
    return pixel[0];
  }
  try {
    batch.begin();
    if (!batch.add(0, 0, 0, 1) || batch.add(1, 0, 0, 1)) throw Error('capacity was not respected');
    batch.end();
    renderer.render(scene, camera);
    const center = sample(32), mid = sample(39), outside = sample(53);
    if (!(center >= 126 && center <= 129 && mid > center && mid < outside && outside === 255)) {
      throw Error('unexpected contact profile: ' + [center, mid, outside]);
    }
    if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 2) throw Error('unexpected contact draw count');
    batch.begin();
    batch.end();
    renderer.render(scene, camera);
    if (sample(32) !== 255 || renderer.info.render.calls !== 0) throw Error('stale contact after reset');
    return 'PASS radial profile, capacity, one draw, empty frame';
  } finally {
    batch.dispose();
    target.dispose();
    renderer.dispose();
  }
}

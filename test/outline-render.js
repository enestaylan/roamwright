import * as THREE from 'three';
import { glowLines } from 'roamwright/rendering/glow-lines.js';
import { glowShell } from 'roamwright/rendering/glow-shell.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(64, 64);
  const camera = new THREE.OrthographicCamera(-2,2,2,-2,0.1,20);
  camera.position.set(0,1,5);
  camera.lookAt(0,1,0);
  const scene = new THREE.Scene();
  const segments = [-1,2,0,1,2,0];
  const lines = glowLines(segments, 0xffffff);
  lines.material.uniforms.screen.value.set(64,64);
  const shell = glowShell(segments, () => 0, 0xffffff);
  scene.add(lines, shell);
  renderer.setRenderTarget(target);
  try {
    renderer.render(scene, camera);
    const counts = renderer.info.render;
    if (counts.calls !== 2 || counts.triangles !== 4) throw Error('unexpected batch size');
    const data = new Uint8Array(64 * 64 * 4);
    renderer.readRenderTargetPixels(target,0,0,64,64,data);
    const red = (x,y) => data[4 * (y*64+x)];
    if (!(red(32,47)>red(32,32) && red(32,32)>0 && red(4,32)===0)) throw Error('expected a bright rim and soft interior');
    return 'PASS rim, shell, two draws and four triangles';
  } finally {
    for (const mesh of [lines,shell]) {mesh.geometry.dispose();mesh.material.dispose();}
    target.dispose();
    renderer.dispose();
  }
}

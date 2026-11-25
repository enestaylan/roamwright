import * as THREE from 'three';
import { createRoadMaterial } from 'roamwright/rendering/road-surface.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function run(canvas) {
  const size = 96;
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(size, size);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4, 4, 12, -12, 0.2, 60);
  camera.position.set(0, 10, 4);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xc0deff, 0x53472b, 2));
  const grit = new THREE.DataTexture(new Uint8Array([126, 128, 128, 255]), 1, 1);
  grit.needsUpdate = true;
  const dampness = { value: 0 };
  const material = createRoadMaterial({ grit, dampness });
  const geometry = new THREE.PlaneGeometry(8, 28, 1, 5).rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = [];
  const verge = [];
  const road = [];
  for (let i = 0; i < positions.count; i++) {
    colors.push(0.43, 0.3, 0.18, 1);
    verge.push(0.45, 0.37, 0.22);
    road.push(positions.getX(i), 30 + positions.getZ(i), 2.7, 0.12);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('verge', new THREE.Float32BufferAttribute(verge, 3));
  geometry.setAttribute('road', new THREE.Float32BufferAttribute(road, 4));
  scene.add(new THREE.Mesh(geometry, material));
  renderer.setRenderTarget(target);
  const draw = damp => {
    dampness.value = damp;
    renderer.render(scene, camera);
    assert(renderer.info.render.calls === 1, 'Road must draw once');
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    return pixels;
  };
  try {
    const dry = draw(0);
    const drying = draw(0.04);
    const wet = draw(1);
    assert(dry.every((value, i) => drying[i] === value), 'Drying ruts still appear wet');
    assert(wet.filter((value, i) => Math.abs(dry[i] - value) > 3).length > 25, 'Rain did not fill the ruts');
    assert(dry.every((value, i) => {
      const column = (i >> 2) % size;
      return (column > 12 && column < size - 13) || value === wet[i];
    }), 'Rain changed pixels away from the ruts');
    return 'PASS dry and rain-filled ruts share one draw';
  } finally {
    geometry.dispose();
    material.dispose();
    grit.dispose();
    target.dispose();
    renderer.dispose();
  }
}

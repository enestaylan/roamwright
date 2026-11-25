import * as THREE from 'three';
import { applyCrowdSkinning, bakeCrowdFrame, castCrowdShadow, createCrowdBatch } from 'roamwright/rendering/crowd-skinning.js';

export function run(canvas) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('aJoints', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  geometry.setAttribute('aWeight', new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute('aPalette', new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const tex = (data, width) => {
    const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
  };
  const pose = new Float32Array([1, 0, 0, 0.25, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 0.4, 1, 1]);
  const poseUniform = { value: tex(pose, 4) };
  const baked = { geo: geometry, vertices: new Float32Array(count * 4), k: 0 };
  bakeCrowdFrame(baked, pose);
  if (baked.k !== count * 4) throw new Error('Missing baked vertices');
  const walk = tex(baked.vertices, count);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.z = 2;
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(80, 80, false);
  const target = new THREE.WebGLRenderTarget(80, 80);
  renderer.setRenderTarget(target);
  const shaders = (bakedMotion) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
    const depth = new THREE.MeshDepthMaterial();
    const distance = new THREE.MeshDistanceMaterial();
    for (const mat of [material, depth, distance]) {
      mat.onBeforeCompile = shader => applyCrowdSkinning(shader, {
        poseUniform, walk: bakedMotion ? walk : null, depth: mat !== material, paletteOffset: 3,
      });
      mat.customProgramCacheKey = () => bakedMotion ? 'baked poses' : 'live poses';
    }
    return [material, depth, distance];
  };
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const [nearMat, nearDepth, nearDistance] = shaders(false);
  const [farMat, farDepth, farDistance] = shaders(true);
  const near = createCrowdBatch(scene, geometry.clone(), 1, nearMat, [nearDepth, nearDistance], 'weighted');
  const far = createCrowdBatch(scene, geometry.clone(), 1, farMat, [farDepth, farDistance], 'baked');
  near.mesh.count = 1;
  castCrowdShadow(scene, near, geometry.clone(), [nearDepth, nearDistance]);
  const light = new THREE.DirectionalLight(0xffffff);
  light.castShadow = true;
  light.position.set(0, 0, 4);
  scene.add(light);
  const read = () => {
    const pixels = new Uint8Array(80 * 80 * 4);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 80, 80, pixels);
    if (!pixels.some((x, i) => i % 4 === 2 && x > 0)) throw Error('Expected a visible blue crowd');
    return pixels;
  };
  try {
    const weighted = read();
    near.mesh.count = 0;
    far.mesh.count = 1;
    const sampled = read();
    if (!sampled.every((x, i) => x === weighted[i])) throw Error('Live and baked pose pixels differ');
    near.mesh.count = near.shadow.count = 1;
    renderer.shadowMap.enabled = true;
    renderer.render(scene, camera);
    if (renderer.getContext().getError()) throw Error('Crowd shadow compilation failed');
  } finally {
    renderer.dispose();
    target.dispose();
    poseUniform.value.dispose();
    walk.dispose();
  }
  return 'PASS crowd pose baking, rendering, palette and shadow';
}

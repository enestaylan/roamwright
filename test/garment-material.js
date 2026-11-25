import * as THREE from 'three';
import { garmentTag, KIND } from 'roamwright/geometry/garment-tags.js';
import { garmentShader } from 'roamwright/rendering/garment-material.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const target = new THREE.WebGLRenderTarget(48, 48);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  camera.position.z = 0.25;
  const scene = new THREE.Scene();
  const tex = new THREE.DataTexture(new Uint8Array([128, 165, 200, 255]), 1, 1);
  tex.needsUpdate = true;
  const stages = garmentShader({ threads: 48, textureSize: 1 });
  const material = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const uniform = { value: garmentTag(0.8, KIND.linen) };
  material.onBeforeCompile = shader => {
    shader.uniforms.uTag = uniform;
    shader.uniforms.uFolds = shader.uniforms.uCrumple = { value: tex };
    shader.vertexShader = 'varying vec3 vL;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvL = position;');
    shader.fragmentShader = 'uniform float uTag; varying vec3 vL;\n'+stages.declarations+'\n'+shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat vSk = uTag, gH = 0.5; vec4 tx = vec4(0.5);\n'+stages.color)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n'+stages.roughness)
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\n'+stages.metalness)
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+stages.normal);
  };
  const geometry = new THREE.PlaneGeometry(0.18, 0.18);
  scene.add(new THREE.Mesh(geometry, material), new THREE.AmbientLight(0xffffff, 2));
  renderer.setRenderTarget(target);
  try {
    const sample = () => {
      renderer.render(scene, camera);
      if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 2) throw Error('Unexpected garment draw counts');
      const pixel = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, 24, 24, 1, 1, pixel);
      return pixel[0];
    };
    const linen = sample();
    uniform.value = garmentTag(0.8, KIND.plate);
    const plate = sample();
    if (!(linen > plate && plate > 0)) throw Error('Surface tags produced unexpected tones: ' + [linen, plate]);
    return 'Skin and garment stages compiled; linen and plate render in one draw';
  } finally {
    geometry.dispose(); material.dispose(); tex.dispose(); target.dispose(); renderer.dispose();
  }
}

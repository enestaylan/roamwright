import * as THREE from 'three';
import { garmentTag, KIND } from 'roamwright/geometry/garment-tags.js';
import { HAIR_LIE, HAIR_PARS, HAIR_SHEEN, HAIR_STRANDS, smoothOf } from 'roamwright/rendering/hair-strands.js';
import { garmentShader } from 'roamwright/rendering/garment-material.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const size = 160;
  const target = new THREE.WebGLRenderTarget(size, size);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  camera.position.z = 0.25;
  const scene = new THREE.Scene();
  const tex = new THREE.DataTexture(new Uint8Array([128, 165, 200, 255]), 1, 1);
  tex.needsUpdate = true;
  const stages = garmentShader({ threads: 48, textureSize: 1, smoothness: smoothOf('vSk') });
  const material = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const uniform = { value: garmentTag(0.8, KIND.linen) };
  material.onBeforeCompile = shader => {
    shader.uniforms.uTag = uniform;
    shader.uniforms.uFolds = shader.uniforms.uCrumple = { value: tex };
    shader.vertexShader = 'varying vec3 vL;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvL = position + vec3(0.0, 0.0, 0.12);');
    shader.fragmentShader = 'uniform float uTag; varying vec3 vL;\n'+stages.declarations+HAIR_PARS+'\n'+shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat vSk = uTag + vL.x * 0.02, gH = 0.5; vec4 tx = vec4(0.5);\n'+stages.color+HAIR_STRANDS)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n'+stages.roughness+HAIR_SHEEN)
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\n'+stages.metalness)
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+stages.normal+HAIR_LIE);
  };
  const geometry = new THREE.PlaneGeometry(0.18, 0.18);
  scene.add(new THREE.Mesh(geometry, material), new THREE.AmbientLight(0xffffff, 2));
  renderer.setRenderTarget(target);
  try {
    const draw = () => {
      renderer.render(scene, camera);
      if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 2) throw Error('Unexpected garment draw counts');
    };
    const sample = () => {
      draw();
      const pixel = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, size / 2, size / 2, 1, 1, pixel);
      return pixel[0];
    };
    const centerContrast = distance => {
      camera.position.z = distance;
      draw();
      const width = 24, pixels = new Uint8Array(width * width * 4);
      renderer.readRenderTargetPixels(target, (size - width) / 2, (size - width) / 2, width, width, pixels);
      let darkest = 255, brightest = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        darkest = Math.min(darkest, pixels[i]);
        brightest = Math.max(brightest, pixels[i]);
      }
      return brightest - darkest;
    };
    const linen = sample();
    uniform.value = garmentTag(0, KIND.plate);
    const plate = sample();
    if (!(linen > plate && plate > 0)) throw Error('Surface tags produced unexpected tones: ' + [linen, plate]);
    uniform.value = garmentTag(1, KIND.plate);
    const rim = sample();
    if (!(rim > plate)) throw Error('An exposed edge should be brighter than the plate face: ' + [rim, plate]);
    uniform.value = 3.2;
    if (sample() <= 0) throw Error('Strands did not render');
    uniform.value = garmentTag(0, KIND.mail);
    const near = centerContrast(0.16), far = centerContrast(0.95);
    if (!(near > 10 && far < 3)) throw Error('Mail links must resolve nearby and fade at a distance: ' + [near, far]);
    return 'Hair, skin, linen, worn plate and pixel-filtered mail render in one draw';
  } finally {
    geometry.dispose(); material.dispose(); tex.dispose(); target.dispose(); renderer.dispose();
  }
}

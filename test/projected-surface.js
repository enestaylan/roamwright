import * as THREE from 'three';
import { createProjectedMaterial, projectedVaryings, triplanarColor, surfaceRelief } from 'roamwright/rendering/surface-projection.js';
import { thinSurfaceLight, wetSurface } from 'roamwright/rendering/surface-light.js';
import { mappedRoom } from 'roamwright/rendering/interior-mapping.js';
import { crustGLSL } from 'roamwright/rendering/crust.js';

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  const size = 64;
  const target = new THREE.WebGLRenderTarget(size, size);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(1.5, 1, 4);
  camera.lookAt(0, 0, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(2, 3, 1);
  scene.add(sun);
  const grain = new THREE.DataTexture(new Uint8Array([190, 156, 141, 255]), 1, 1);
  grain.needsUpdate = true;
  const damp = { value: 0 };
  const feature = { value: 0 };
  const room = mappedRoom({ dimensions: '1.0, 1.2, 0.8', shade: 'return vec3(0.2 + h.y * 0.6);' });
  const material = createProjectedMaterial(
    { roughness: 0.92 },
    {
      cacheKey: 'sample-projected-box',
      uniforms: { grain: { value: grain }, damp, feature },
      declarations: projectedVaryings + '\nuniform sampler2D grain; uniform float damp, feature; float height = 0.0;\n' + crustGLSL,
      color:
        triplanarColor({ texture: 'grain', scale: '0.5', gain: '1.0', height: 'height' }) +
        '\nheight += crustCracks(vL.xy * 5.0, vec2(0.0)).x * feature; diffuseColor.rgb *= mix(vec3(1.0), roomBehind(0.0), feature);',
      normal: surfaceRelief({ height: 'height', strength: '0.7', fadeStart: '2.0', fadeEnd: '20.0' }),
      finish(shader) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <normal_pars_fragment>', '#include <normal_pars_fragment>\n' + room)
          .replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n' +
              wetSurface({ dampness: 'damp', darkening: '(0.35 + 0.25 * up)', roughness: '0.2', sheen: '0.7' }),
          )
          .replace('#include <opaque_fragment>', thinSurfaceLight({ sky: 0.1, sun: 0.2, glow: 0.2 }));
      },
    },
  );
  const geometry = new THREE.BoxGeometry();
  const box = new THREE.InstancedMesh(geometry, material, 1);
  box.setMatrixAt(0, new THREE.Matrix4().makeScale(1.8, 1.4, 1));
  scene.add(box);
  renderer.setRenderTarget(target);
  function draw() {
    renderer.render(scene, camera);
    if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 12) throw Error('Expected one box');
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    return pixels;
  }
  try {
    const dry = draw();
    const center = 4 * ((size / 2) * size + size / 2);
    if (dry[center] < 16) throw Error('Projected box missing');
    damp.value = 1;
    const wet = draw();
    if (wet[center] >= dry[center]) throw Error('Rain should darken the wall');
    feature.value = 1;
    const detailed = draw();
    if (detailed.every((v, i) => Math.abs(wet[i] - v) <= 2)) throw Error('Expected interior and crust detail');
    if (renderer.info.programs.length !== 1) throw Error('Uniform changes compiled another program');
    return 'PASS projected box, rain, transmission, room intersection and crust in one draw / 12 triangles';
  } finally {
    box.dispose();
    geometry.dispose();
    material.dispose();
    grain.dispose();
    target.dispose();
    renderer.dispose();
  }
}

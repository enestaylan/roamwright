import * as THREE from 'three';
import { createWakes } from 'roamwright/rendering/wakes.js';
import { createWaterMaterials, landWater, rippledStream } from 'roamwright/rendering/water-material.js';
import { seaParameters } from 'roamwright/rendering/sea-shaders.js';
import { createPlanarReflection } from 'roamwright/rendering/planar-reflection.js';
import { streamGeometry } from 'roamwright/geometry/stream.js';
import { STREAM_FLOW_GLSL } from 'roamwright/rendering/stream-flow.js';

const SIZE = 128;
function checkStreamFlow(renderer, target) {
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, footprint: { value: 0.1 } },
    vertexShader: 'varying vec2 sampleUV; void main() { sampleUV = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: `
      uniform float time, footprint;
      varying vec2 sampleUV;
      ${STREAM_FLOW_GLSL}
      void main() {
        vec2 metres = (sampleUV - 0.5) * 80.0;
        vec4 motion = streamFlow(vec3(metres.x / 40.0, metres.y, 0.45), metres.x, 2.0, time * 2.5, 45.0, footprint);
        gl_FragColor = vec4(0.5 + motion.xy * 1.5, motion.z, motion.w);
      }
    `,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const draw = (time, footprint) => {
    material.uniforms.time.value = time;
    material.uniforms.footprint.value = footprint;
    renderer.render(scene, camera);
    if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== 2) throw Error('stream test draw counts');
    const bytes = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, bytes);
    return bytes;
  };
  try {
    const offset = 8;
    const before = draw(0, 0.1), later = draw((80 * offset / SIZE) / 2.5, 0.1);
    const distant = draw(0, 100);
    let across = 0, along = 0, worstShift = 0;
    for (let y = 0; y < SIZE - offset; y++)
      for (let x = 0; x < SIZE - 1; x++) {
        const i = (y * SIZE + x) * 4;
        across += Math.abs(before[i] - before[i + 4]);
        along += Math.abs(before[i] - before[i + SIZE * 4]);
        for (const axis of [0, 1, 2])
          worstShift = Math.max(worstShift, Math.abs(before[i + axis] - later[i + axis + offset * SIZE * 4]));
        if (distant[i] !== 128 || distant[i + 1] !== 128 || distant[i + 2] !== 0) throw Error('subpixel stream detail remained');
      }
    if (worstShift > 1) throw Error('stream detail did not advect downstream');
    if (across < along * 1.4) throw Error('stream ripples span the channel instead of following the flow');
    if (!distant.some((value, i) => i % 4 === 3 && value > 0)) throw Error('averaged rapids were lost at distance');
  } finally {
    material.dispose();
    geometry.dispose();
  }
}

export function run(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas});
  renderer.setSize(128,128,false);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8899aa,50,100);
  const camera = new THREE.PerspectiveCamera(55,1,.1,100);
  camera.position.set(0,3,8); camera.lookAt(0,0,0); camera.updateMatrixWorld();
  const wakes = createWakes({slots: 2});
  const rect = new THREE.Vector4(.5,.5,.05,.05);
  const pars = seaParameters({moleCount:1,quayCount:2,moleReach:1.3,moleWidth:5});
  const {waterMat,streamMat} = createWaterMaterials({depthRect:rect,level:0,seaParameters:pars,wakes});
  const depth = new THREE.DataTexture(new Uint8Array([250,0,0,255]),1,1);
  depth.needsUpdate=true;
  const sea = landWater(waterMat,depth,rect,0,{
    uSeaO:{value:new THREE.Vector4(0,0,1,0)}, uSwellDir:{value:new THREE.Vector2(1,0)},
    uMole:{value:[new THREE.Vector4()]}, uMoleF:{value:[new THREE.Vector4()]},
    uQuay:{value:[new THREE.Vector4(),new THREE.Vector4()]},
  }).open;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(10,10).rotateX(-Math.PI/2),sea));
  const target = new THREE.WebGLRenderTarget(128,128);
  renderer.setRenderTarget(target);
  const pass = createPlanarReflection({renderer,camera,scene,drawnSize:()=>[128,128],waterCells:()=>[-2,-2],cellSize:4,minSize:32});
  pass.renderMirror(waterMat.uniforms,0,1,false,1);
  if(renderer.getRenderTarget()!==target || !pass.mirror.on || !waterMat.uniforms.uRefl.value) throw Error('mirror state');
  renderer.render(scene,camera);
  if(!renderer.info.render.calls || renderer.getContext().getError()) throw Error('water drawing failed');
  scene.clear();
  const stream = streamGeometry([[0,-5],[0,0],[0,5]], 4, () => 0, [0,0,0]);
  const riffles = rippledStream(streamMat, { speed: 2.5, rapidSpeed: 4 });
  if (riffles.uniforms.uTime !== streamMat.uniforms.uTime || streamMat.defines.STREAM_RIFFLES !== undefined)
    throw Error('stream variant changed its source or lost the shared clock');
  streamMat.uniforms.uTime.value = 8;
  streamMat.uniforms.uHorizon.value.setRGB(0.6, 0.7, 0.85);
  streamMat.uniforms.uZenith.value.setRGB(0.05, 0.19, 0.52);
  const ribbon = new THREE.Mesh(stream, streamMat);
  scene.add(ribbon);
  const pixels = material => {
    ribbon.material = material;
    renderer.render(scene, camera);
    if (renderer.info.render.calls !== 1 || renderer.info.render.triangles !== stream.index.count / 3 || renderer.getContext().getError())
      throw Error('stream drawing failed');
    const bytes = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, bytes);
    return bytes;
  };
  const before = pixels(streamMat), after = pixels(riffles);
  if (!before.some((v, i) => Math.abs(v - after[i]) > 3)) throw Error('ripple material did not change the rendered stream');
  checkStreamFlow(renderer, target);
  stream.dispose(); riffles.dispose(); streamMat.dispose();
  pass.dispose(); target.dispose(); renderer.dispose();
  return 'PASS water surface, downstream advection, subpixel fade and planar reflection';
}

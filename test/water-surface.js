import * as THREE from 'three';
import { createWakes } from 'roamwright/rendering/wakes.js';
import { createWaterMaterials, landWater } from 'roamwright/rendering/water-material.js';
import { seaParameters } from 'roamwright/rendering/sea-shaders.js';
import { createPlanarReflection } from 'roamwright/rendering/planar-reflection.js';
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
  const {waterMat} = createWaterMaterials({depthRect:rect,level:0,seaParameters:pars,wakes});
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
  pass.dispose(); target.dispose(); renderer.dispose();
  return 'PASS water surface and planar reflection';
}

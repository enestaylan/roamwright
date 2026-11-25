import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {installShadowDepth} from '../rendering/shadow-depth.js';

test('instance sphere offsets, nonuniform transforms, light changes and custom materials', () => {
  const active = {}, unrelated = {}, hooks = installShadowDepth(active);
  const geometry = new THREE.BoxGeometry(2,2,2).translate(10,0,0);
  const mesh = new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial(),1);
  mesh.setMatrixAt(0,new THREE.Matrix4());
  mesh.scale.set(2,3,4);
  mesh.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(50,1,.1,2);
  const distance = new THREE.MeshDistanceMaterial();
  const draw = renderer => {
    mesh.onBeforeShadow(renderer,null,null,camera,geometry,distance);
    const count = mesh.count;
    mesh.onAfterShadow(renderer,null,null,camera,geometry,distance);
    assert.equal(mesh.count,1);
    return count;
  };
  try {
    assert.equal(draw(unrelated),1);
    assert.equal(draw(active),0);
    camera.position.set(20,0,0);
    assert.equal(draw(active),1);
    camera.position.set(2,6,0); // same x + 3*y, different reach
    assert.equal(draw(active),0);
    camera.far=24;
    assert.equal(draw(active),1);
    mesh.rotation.y=Math.PI;
    mesh.updateMatrixWorld();
    camera.far=2;
    camera.position.set(-20,0,0);
    assert.equal(draw(active),1);
    const own = new THREE.MeshDistanceMaterial();
    mesh.customDistanceMaterial=own;
    draw(active);
    assert.equal(mesh.customDistanceMaterial,own);
  } finally { hooks.dispose(mesh); }
  assert.equal(draw(active),1);
});

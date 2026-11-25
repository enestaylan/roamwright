import * as THREE from 'three';
import { createGridCache } from 'roamwright/runtime/grid-cache.js';
import { createHeightProbe } from 'roamwright/rendering/height-probe.js';
import { createEvents } from 'roamwright/runtime/events.js';

export async function run(canvas) {
  const opts={database:'fixture-grids',store:'samples',hintPrefix:'fixture:',build:'a'};
  const a=createGridCache(opts), source=new Float32Array([1.25,-3]), dest=new Float32Array(2);
  await a.keep('slope',[source]);
  if (!a.hasKept('slope') || !(await a.takeKept('slope',[dest])) || dest[0]!==1.25 || dest[1]!==-3) throw Error('cache round trip');
  const b=createGridCache({...opts,build:'b'});
  if (b.hasKept('slope') || await b.takeKept('slope',[dest])) throw Error('cache namespace');
  await b.keep('slope',[source]);
  if(await a.takeKept('slope',[dest]) || await b.takeKept('slope',[new Uint32Array(2)])) throw Error('stale grid or invalid type');
  const events=createEvents(), other=createEvents(), log=[];
  events.on('tick',(a,b)=>log.push(a,b));events.on('tick',()=>log.push(3));other.emit('tick',0);events.emit('tick',1,2);
  if(log.join()!=='1,2,3')throw Error('event order');
  const renderer=new THREE.WebGLRenderer({canvas}), scene=new THREE.Scene();
  const box=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial());
  box.position.y=1;scene.add(box);
  const probe=createHeightProbe(renderer,scene,{size:16,above:12,below:2,layer:4});
  try {
    const [hit,miss]=await Promise.all([probe.measure(0,0,0,1),probe.measure(20,0,0,1)]);
    if(Math.abs(hit-2)>.01||miss!==0||box.layers.mask!==1||renderer.getRenderTarget()!==null||scene.overrideMaterial)throw Error('height/state: '+[hit,miss]);
    return 'PASS persisted grid, version isolation, event order, overlapping height queries';
  }finally{probe.dispose();box.geometry.dispose();box.material.dispose();renderer.dispose();}
}

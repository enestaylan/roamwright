import * as THREE from 'three';
import { createGridCache } from 'roamwright/runtime/grid-cache.js';
import { createShaderWarmup } from 'roamwright/rendering/shader-warmup.js';
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
  const first = createGridCache({...opts, revisions: {slope: 'v1', rocks: 'v1'}});
  await first.keep('slope', [source]);
  await first.keep('rocks', [source]);
  const next = createGridCache({...opts, revisions: {slope: 'v2', rocks: 'v1'}});
  if (next.hasKept('slope') || await next.takeKept('slope', [dest])) throw Error('changed input reused');
  if (!next.hasKept('rocks') || !(await next.takeKept('rocks', [dest]))) throw Error('independent grid lost');
  await next.keep('slope', [new Float32Array([4,5])]);
  if (await first.takeKept('slope', [dest]) || await b.takeKept('slope', [dest])) throw Error('superseded record retained');
  if (!(await next.takeKept('rocks', [dest])) || dest[0] !== 1.25) throw Error('other record overwritten');
  if (!(await next.takeKept('slope', [dest])) || dest[0] !== 4) throw Error('new revision lost');
  await next.keep('unknown', [source]);
  if (next.hasKept('unknown') || await next.takeKept('unknown', [dest])) throw Error('unversioned grid stored');
  const events=createEvents(), other=createEvents(), log=[];
  events.on('tick',(a,b)=>log.push(a,b));events.on('tick',()=>log.push(3));other.emit('tick',0);events.emit('tick',1,2);
  if(log.join()!=='1,2,3')throw Error('event order');
  const renderer=new THREE.WebGLRenderer({canvas}), scene=new THREE.Scene();
  const box=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial());
  box.position.y=1;scene.add(box);
  const probe=createHeightProbe(renderer,scene,{size:16,above:12,below:2,layer:4});
  scene.fog=new THREE.Fog(0xeeeeee,1,20);
  const light=new THREE.DirectionalLight();
  light.layers.set(5);
  const instances=new THREE.InstancedMesh(box.geometry,[box.material],1);
  instances.setMatrixAt(0,new THREE.Matrix4().makeTranslation(2,1,0));
  scene.add(light,instances);
  const warm=createShaderWarmup({renderer,scene,camera:new THREE.PerspectiveCamera()});
  try {
    await probe.warm(scene,warm.warmStandIns);
    const prepared=renderer.info.programs.length;
    const [hit,miss]=await Promise.all([probe.measure(0,0,0,4),probe.measure(20,0,0,1)]);
    if(prepared!==2 || renderer.info.programs.length!==prepared)throw Error('first probe draw linked an unprepared depth program');
    if(Math.abs(hit-2)>.01||miss!==0||box.layers.mask!==1||renderer.getRenderTarget()!==null||scene.overrideMaterial)throw Error('height/state: '+[hit,miss]);
    return 'PASS persisted grid, version isolation, event order, overlapping height queries';
  }finally{warm.dispose();probe.dispose();box.geometry.dispose();box.material.dispose();renderer.dispose();}
}

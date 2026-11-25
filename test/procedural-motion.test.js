import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { makeRig, stepRig, LEGS } from 'roamwright/motion/quadruped.js';
import { sampleSurface } from 'roamwright/geometry/sampled-surface.js';
import { erodeHeightfield } from 'roamwright/geometry/erosion.js';
import { mulberry32 } from 'roamwright/math/random.js';

test('four planted feet and their joint rotations follow fixed turns, slopes and a teleport', () => {
  const joints = Array.from({length: 30}, () => [0, 1, 0]);
  const feet = [];
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 0.24 : -0.24, z = i < 2 ? 0.55 : -0.55;
    joints[i < 2 ? 2 : 1] = [0, 1.08, z];
    for (let j = 0; j < 4; j++) joints[LEGS[i]+j] = [x, 1.04 - j * 0.27, z + (j % 2 ? 0.06 : 0)];
    feet.push([x, 0, z+0.04]);
  }
  const habits = {glide:.04,heel4:.3,fold4:.4,sink:.12,follow:.35,heel3:.15,fold3:.35,thigh:.7};
  const keys = [[0,.5,.7,[0,.5,.75,.25],.03,.12,.08],[2,.9,.48,[0,.5,.5,0],.12,.25,.15]];
  const rig = makeRig(joints, feet, {fore:habits,hind:{...habits,paired:true},crouch:.08,gaits:keys,phase:.25});
  rig.ph = .25;
  const hash = createHash('sha256');
  const ground = (x,z) => x * .05 + z * .025;
  for (let i = 0; i < 100; i++) {
    const x = i < 70 ? i*.008 : 20, z = i < 70 ? i*.028 : 2;
    stepRig(rig, {x,y:ground(x,z),z,s:1,yaw:i*.004,ground}, 1/60);
    for (const bone of rig.bones) {
      for (const v of [...bone.position.toArray(), ...bone.quaternion.toArray()]) {
        assert.ok(Number.isFinite(v));
        hash.update(v.toFixed(7) + ',');
      }
    }
  }
  assert.equal(hash.digest('hex'), '6fcd453c0b8d97de701743f37a924b63f2875bafa78a4bdfe1b4c434275cadbe');
});

test('parametric normals, winding, two-sided faces and interpolated colors match the vertex stream', () => {
  const hash = createHash('sha256');
  const gb = {raw(...args) {hash.update(JSON.stringify(args));}};
  for (const flip of [false,true]) for (const blend of [false,true]) for (const back of [false,true,[1,0,0]]) {
    sampleSurface(gb, 4, 3, (u,v)=>[u,u*v,v], (u,v)=>[u,v,.25], {flip, blend, back});
  }
  assert.equal(hash.digest('hex'), 'dd099c53cb55a488bb94810989d893e5455ef4551e6ac9dfb5a6e6276725cbd3');
});

test('droplets reproduce the height bytes and leave protected cells untouched', () => {
  const width=25;
  const height=Float32Array.from({length:width*width},(_,i)=>0.7*(i%width)+0.5*Math.floor(i/width));
  const mask=Float32Array.from(height,(_,i)=>i%width<4?0:1);
  const initial=height.slice();
  erodeHeightfield(height,width,mask,mulberry32(27811),{drops:1500,lifetime:20,inertia:.08,capacityFactor:.13,minCapacity:.004,erosionRate:.4,depositRate:.28,evaporation:.025,gravity:.45,radius:2.2,maxChange:8});
  for(let i=0;i<height.length;i++) if (!mask[i]) assert.equal(height[i],initial[i]);
  assert.equal(createHash('sha256').update(new Uint8Array(height.buffer)).digest('hex'), 'ad9ed293cb04a65fdcd87ad6834df535721d27491f845d28c748af752742bd94');
});

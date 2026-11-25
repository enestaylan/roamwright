import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { headFn } from 'roamwright/geometry/head-shape.js';
import { createSculptor } from 'roamwright/geometry/sculpt.js';
import { createHairShells, massOf, placeHairShell, roundPole } from 'roamwright/geometry/hair-shell.js';
import { POINT, packHairPatch } from 'roamwright/geometry/hair-patch.js';
import { hang, knot, plait } from 'roamwright/geometry/hair-gathers.js';
import { drawLock, layLock } from 'roamwright/geometry/hair-locks.js';
import { isHair } from 'roamwright/geometry/hair-tags.js';

test('a fitted hair shell clips to the hairline and shares its strands with the lock ribbons', () => {
  const skull = headFn(), mass = massOf({skull, scale:[1.05,1.09,1.08], inHair:(x,y)=>y-0.15});
  const shells = createHairShells(createSculptor().sculptMesh);
  const across = roundPole(new Vector3(0,1,0));
  const shell = shells('short',mass,across);
  assert.equal(shells('short',mass,across),shell);
  const tint = (inside, dx, dy, dz, out) => out.fill(0.2+0.1*inside);
  const surface = placeHairShell(shell, p=>p, tint);
  assert.ok(surface.points.length > POINT*50 && surface.points.every(Number.isFinite));
  const patch={points:[], triangles:[]}, root = new Vector3(0.2,0.8,-0.4).normalize();
  const path = layLock(mass,root,{length:0.035,segs:4,base:0.001,rise:0.001,tip:0.001,aside:[0,0],flow:(d,out)=>out.set(0,-1,-1),neck:0.05,shoulder:0.13});
  drawLock(patch,p=>p,mass,path,0.003,[0.2,0.1,0.08],1,0.4);
  assert.ok(patch.points.every(Number.isFinite) && patch.triangles.length>0);
  let n=0;
  const corners=packHairPatch(surface.points,surface.triangles,(offset,tag)=>{
    assert.ok(offset % POINT === 0 && isHair(tag) && tag < 4); n++;
  });
  assert.equal(corners.length, surface.triangles.length);
  assert.ok(n>0 && corners.every(i=>i<n));
});

test('open hair sheets, knots and braided tails produce finite indexed bands', () => {
  const rings=[[0.2,0.016,0.014,0,0],[0.03,0.01,0.013,0,-0.01]], colour=[0.2,0.1,0.1];
  for (const append of [
    patch=>hang(patch,rings,{rows:8,sides:6,colour,a0:-Math.PI,a1:0}),
    patch=>plait(patch,rings,{turn:0.035,sides:8,side:0,colour}),
    patch=>knot(patch,p=>p,[0,0.1,0],[0.02,0.02,0.04],colour,6,8),
  ]){
    const patch={points:[],triangles:[]};
    append(patch);
    assert.ok(patch.points.every(Number.isFinite) && patch.triangles.length>3);
    assert.ok(patch.triangles.every(i=>i>=0 && i < patch.points.length / POINT));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Scene, Object3D, Vector3 } from 'three';
import { createShoreGrid, outlineDistance, outlineEdges } from '../geometry/shore-grid.js';
import { streamGeometry } from '../geometry/stream.js';
import { terrainChunks } from '../geometry/terrain-chunks.js';
import { createWakes } from '../rendering/wakes.js';

test('each shoreline has independent bake and sampling state', () => {
  const outline = [[-1,-1],[1,-1],[1,-1],[1,1],[-1,1]];
  assert.equal(outlineDistance(outlineEdges(outline),0,0),1);
  const a = createShoreGrid(), b = createShoreGrid();
  a.layOutShore(-2,-2,1,5); b.layOutShore(-4,-4,2,5);
  a.bakeShore([outline]); b.bakeShore([outline.map(([x,z])=>[2*x,2*z])]);
  assert.equal(a.shoreDistance(0,0),1); assert.equal(b.shoreDistance(0,0),2);
  assert.equal(a.shoreDistance(-1.5,0),-0.5);
});

test('stream banks clip disconnected wet ground on the far side of a bank', () => {
  const g = streamGeometry([[0,0],[0,8],[0,16]],4,()=>2,[1.2,1,0],{
    reach:6, ground:x=>Math.abs(x)>1 && Math.abs(x)<6 ? 5:0,
  });
  assert.equal(g.index.count,96);
  const bank=g.getAttribute('aBank');
  assert.ok(bank.getX(9)<0 && bank.getX(17)<0 && bank.getX(13)>0);
  assert.ok([...g.getAttribute('position').array].every(Number.isFinite));
});

test('wake slots follow the nearest visible moving hull and clear on removal', () => {
  const scene = new Scene(), nearer = new Object3D(), farther = new Object3D();
  scene.add(nearer,farther); farther.position.z=15; scene.updateMatrixWorld();
  const w=createWakes({slots:1});
  const stop=w.followWake(nearer,5,2); w.followWake(farther,10,3);
  const eye=new Vector3(); w.updateWakes(1,eye);
  assert.equal(w.wakeUniforms.uWakeS.value[0].w,0);
  nearer.position.x=1; farther.position.x=1; scene.updateMatrixWorld(); w.updateWakes(1,eye);
  assert.equal(w.wakeUniforms.uWakeS.value[0].x,5);
  stop(); stop(); farther.position.x=2; scene.updateMatrixWorld(); w.updateWakes(1,eye);
  assert.equal(w.wakeUniforms.uWakeS.value[0].x,10);
  farther.visible=false; w.updateWakes(1,eye); assert.equal(w.wakeUniforms.uWakeS.value[0].w,0);
});

test('terrain switches a chunk between coarse and fine geometry while preserving its skirt and material partition', () => {
  const cells=8, stride=cells+1, n=stride*stride;
  const colors=new Uint8Array(n*3).fill(200), normals=new Float32Array(n*3), heights=new Float32Array(n);
  for (let i=0;i<n;i++) { normals[3*i+1]=1; heights[i]=i%stride; }
  const group=new Group(), camera={position:new Vector3(10000,10000,10000)};
  const live=new Map();
  const createBatch=material=>{
    const batch=new Object3D();
    batch.add=(geometry,start,count)=>{const id=Symbol(); live.set(id,{material,geometry,start,count});return id;};
    batch.remove=id=>live.delete(id);
    return batch;
  };
  const update=terrainChunks(group,{cells,stride,spacing:1,x0:0,z0:0,heights,colors,normals,bedY:3,
    relief:()=>0.2,groundAt:()=>4}, ['ground','bed'], {camera,createBatch});
  const first=[...live.values()][0].geometry;
  assert.equal(first.attributes.position.count,16);
  camera.position.set(4,8,4); update(true);
  const parts=[...live.values()], fine=parts[0].geometry;
  assert.equal(fine.attributes.position.count,27**2);
  assert.deepEqual(parts.map(p=>p.material),['ground','bed']);
  assert.equal(parts.reduce((sum,p)=>sum+p.count,0),fine.index.count);
  assert.ok(fine.boundingBox.min.y<0 && fine.boundingBox.max.y>8);
});

test('starting terrain at a known view builds each piece once and keeps later camera and held-region updates', () => {
  const cells = 8, stride = cells * 3 + 1, points = stride * stride;
  const land = {
    cells, stride, spacing: 1, x0: 0, z0: 0, bedY: 2,
    heights: Float32Array.from({ length: points }, (_, i) => (i % stride) * 0.25),
    colors: new Uint8Array(points * 3).fill(130),
    normalAt: (i, out) => { out[0] = 0; out[1] = 1; out[2] = 0; },
    relief: () => 0.25, groundAt: () => 3,
  };
  const camera = { position: new Vector3() };
  function build(initialPosition) {
    const pieces = new Map();
    const held = [{ box: [16, 16, 24, 24], range: 30, level: 1 }];
    let additions = 0;
    function createBatch(material) {
      const batch = new Object3D();
      batch.add = (geometry, start, count) => {
        const id = ++additions;
        pieces.set(id, { material, geometry, start, count });
        return id;
      };
      batch.remove = id => pieces.delete(id);
      return batch;
    }
    const update = terrainChunks(new Group(), land, ['ground', 'bed'], {
      camera, createBatch, held, initialPosition, distances: [4, 8, 12], fineRange: 2,
    });
    function snapshot() {
      return [...pieces.values()].map(({ material, geometry: g, start, count }) => ({
        key: [g.boundingBox.min.x, g.boundingBox.min.z, material].join('/'),
        attributes: Object.values(g.attributes).map(a => a.array),
        index: g.index.array, start, count,
      })).sort((a, b) => a.key.localeCompare(b.key));
    }
    return { update, held, pieces, snapshot, additions: () => additions };
  }
  for (const eye of [new Vector3(2, 4, 2), new Vector3(2, 400, 2)]) {
    camera.position.set(-100, 700, -100);
    const direct = build(eye), coarse = build();
    camera.position.copy(eye);
    coarse.update(true);
    assert.deepEqual(direct.snapshot(), coarse.snapshot());
    assert.equal(direct.held[0].fine, true);
    assert.equal(direct.additions(), direct.pieces.size);
    assert.ok(coarse.additions() > direct.additions());
    direct.update(true);
    assert.equal(direct.additions(), direct.pieces.size);

    camera.position.set(20, 300, 20);
    for (const terrain of [direct, coarse]) {
      terrain.held.push({ box: [8, 8, 16, 16], range: 20, level: 0 });
      terrain.update(true);
      assert.ok(terrain.held[1].fine);
    }
    assert.deepEqual(direct.snapshot(), coarse.snapshot());
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PointBuckets } from 'roamwright/geometry/point-buckets.js';
import { distanceToRectangle, rectangleCorners, rectanglesOverlap } from 'roamwright/math/rectangles.js';
import { createDeckSurface } from 'roamwright/motion/deck-surface.js';
import { deckTop } from 'roamwright/motion/spaces.js';

test('append-only point queries visit in grid order, widen by size and distinguish distant cells', () => {
  const points = [{x:4,z:0,r:0}, {x:-1,z:0,r:0}, {x:-2,z:1,r:0}];
  const grid = new PointBuckets(points, 4, item => item.r);
  assert.equal(grid.find(0, 0, 4, () => true), points[1]);
  assert.ok(!grid.some(17, 1, 0, () => true));
  points.push({x:12, z:1, r:6});
  assert.equal(grid.find(17, 1, 0, p => Math.hypot(p.x-17,p.z-1) <= p.r, true), points[3]);
  const far = {x:0,z:8192*4,r:0};
  points.push(far);
  assert.ok(!grid.some(4, 0, 0, p => p === far));
  assert.equal(grid.find(far.x, far.z, 0, () => true), far);
});

test('rectangle distances and strict overlaps agree at rotated corners and distant coordinates', () => {
  const box = (x,z,w,d,turn=0) => rectangleCorners(x,z,w,d,turn);
  assert.equal(distanceToRectangle(2,3,1,2,Math.PI/2,2,3),0);
  assert.equal(distanceToRectangle(2,3,1,2,Math.PI/2,6,3),2);
  assert.ok(rectanglesOverlap(box(1e10,2,4,3),box(1e10+2.5,2,2,2,0.4)));
  assert.ok(!rectanglesOverlap(box(0,0,2,2),box(2,0,2,2)));
  assert.ok(!rectanglesOverlap(box(0,0,2,2),box(0,3,2,2,0.75)));
});

test('bounded terrain indexes later decks and matches direct heights on rotated, stacked and sloping surfaces', () => {
  const decks = [], terrain = (x,z) => x/12 - z/17;
  const height = createDeckSurface(decks, terrain, -11,-9,20,2);
  assert.equal(height(1,1),terrain(1,1));
  for (const [x,z,hx,hz,y,angle,k] of [[1,1,3,7,3,0.37,0.2], [2,2,2,1,5,0,0], [-10,-7,3,4,-5,0,-1]]) {
    decks.push({x,z,hx,hz,y,k,c:Math.cos(angle),s:Math.sin(angle)});
    for(let col=-11;col<9;col+=0.5) for(let row=-9;row<11;row+=0.5)
      assert.equal(height(col,row), Math.max(terrain(col,row),deckTop(decks,col,row)));
  }
  assert.equal(height(-12,-7),terrain(-12,-7));
});

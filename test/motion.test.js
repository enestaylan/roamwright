import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { createPlayer } from '../motion/player.js';
import { createSpaces, deckTop } from '../motion/spaces.js';

function ticks(controller, frames) {
  for (let i = 0; i < frames; i++) controller.update(1 / 60);
}

test('rotated sloping decks compose with terrain and reindex after an edit', () => {
  const a = createSpaces({ id: 'a', ground: () => -3 });
  const b = createSpaces({ id: 'b' });
  const ramp = { x: -33, z: 2, hx: 1, hz: 5, c: 0, s: 1, y: 2, k: 0.5 };
  a.decks.push(ramp);
  assert.equal(a.worldSpace.ground(-29, 2), 4);
  assert.equal(a.worldSpace.ground(-33, 4), -3);
  assert.equal(deckTop([], 0, 0), -Infinity);
  a.decks.push({ ...ramp, y: 5, k: 0 });
  assert.equal(a.worldSpace.ground(-29, 2), 5);
  a.decks.pop();
  assert.equal(a.worldSpace.ground(-29, 2), 4);
  ramp.x = 80;
  a.invalidateDecks();
  assert.equal(a.onDeck(-29, 2), false);
  assert.equal(a.onDeck(84, 2), true);
  assert.equal(b.onDeck(84, 2), false);
  a.setTerrain(() => 9);
  assert.equal(a.worldSpace.ground(84, 2), 9);
});

test('collider grids resolve circles and rotated boxes and keep distant buckets distinct', () => {
  const a = createSpaces({ id: 'root' }, { colliderCellSize: 1, maxRadius: 0.5 });
  const room = { id: 'room', grid: new Map() };
  a.spaces.room = room;
  a.addCircle(a.worldSpace, 0, 0, 0.3);
  a.addBox(room, 0, 0, 2, 1, Math.PI / 2);
  a.addCircle(a.worldSpace, -1, 4096, 0.1);
  assert.equal(a.worldSpace.colliders, 2);
  assert.equal(room.colliders, 1);
  const nearby = a.collidersOver(a.worldSpace, -1, -1, 1, 1);
  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].r, 0.3);
  assert.ok(a.collide(0.2, 0, 0.5));
  assert.deepEqual(a.hit, { x: 0.8, z: 0 });
  assert.equal(a.collide(0.81, 0, 0.5), false);
  assert.ok(a.collideIn(a.colliderGrid(nearby), 0.1, 0, 0.5));
  a.useSpace(room);
  assert.equal(a.space, room);
  assert.ok(a.collide(1.1, 0, 0.5));
  assert.ok(Math.abs(a.hit.x - 1.5) < 1e-12);
  a.markBuilt(room.id);
  assert.equal(a.isBuilt('room'), true);
  assert.equal(createSpaces({ id: 'other' }).isBuilt('room'), false);
  a.useSpace(a.worldSpace);
  a.addCircle(a.space, 4, 1.5, 0.6);
  assert.ok(a.steer(4, 0, 0, 1.4, 0.2) > 0);
  assert.ok(a.steer(4, 0, 0, 1.4, 0.2, -1) < 0);
});

test('walking accelerates on normalized axes, jumps, lands and places the camera', () => {
  const spaces = createSpaces({ id: 'floor' });
  const a = createPlayer(spaces, { walk: 3, eye: 1.6, pitchLimit: 1, bobAmplitude: 0.04 });
  const b = createPlayer(spaces);
  a.place(0, 0, 0);
  a.input.right = a.input.forward = 1;
  ticks(a, 120);
  assert.ok(Math.abs(Math.hypot(a.player.vx, a.player.vz) - 3) < 1e-6);
  assert.equal(a.player.x, -a.player.z);
  assert.equal(b.player.x, 0);
  const camera = new PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  a.applyCamera(camera);
  assert.equal(camera.position.x, a.player.x);
  assert.notEqual(camera.position.y, a.player.y);
  a.input.jump = true;
  ticks(a, 1);
  assert.ok(a.player.y > 1.6 && !a.player.grounded);
  a.input.jump = false;
  ticks(a, 100);
  assert.equal(a.player.grounded, true);
  assert.equal(a.player.y, 1.6);
  a.look(10, -100, 0.1);
  a.applyCamera(camera);
  assert.equal(camera.rotation.x, 1);
  assert.equal(camera.rotation.y, -1);
  assert.equal(camera.rotation.order, 'YXZ');
});

test('walking respects a ledge, submerged ground, overhead solids and a wall collider', () => {
  const s = createSpaces({ id: 'floor', water: true, waterLevel: 0 });
  const a = createPlayer(s);
  a.input.right = 1;
  for (const height of [3, -3]) {
    s.setTerrain(x => (x >= 1 ? height : 0));
    a.place(0, 0, 0);
    ticks(a, 240);
    assert.ok(a.player.x < 1);
  }
  s.setTerrain(() => 0);
  s.setOverhead(
    () => -Infinity,
    (_x, _z, nx) => nx >= 1,
    () => null,
  );
  a.place(0, 0, 0);
  ticks(a, 240);
  assert.ok(a.player.x < 1);
  s.setOverhead(
    () => -Infinity,
    () => false,
    () => null,
  );
  s.addBox(s.space, 2, 0, 0.5, 2);
  ticks(a, 240);
  assert.ok(Math.abs(a.player.x - 1.15) < 1e-9);
});

test('flight lifts from a deck, respects water and room ceilings and follows active spaces', () => {
  const s = createSpaces({ id: 'water', water: true, waterLevel: 5, ground: () => -4 });
  const a = createPlayer(s, { eye: 1.5, liftSpeed: 8, liftRange: 2, arrivalHeight: 2 });
  a.input.fly = true;
  a.place(0, 0, 0);
  assert.equal(a.player.y, 8.5);
  a.input.up = -1;
  ticks(a, 120);
  assert.equal(a.player.y, 6.5);
  s.setOverhead(
    (_x, _z, limit) => (limit >= 9 ? 9 : -Infinity),
    () => false,
    () => null,
  );
  a.player.y = 10.5;
  a.liftOff();
  assert.equal(a.player.vy, 8);
  s.useSpace({ id: 'room', ground: () => 0, cx: 0, cz: 0, bound: 6, ceiling: () => 4, flightRoom: 0.3, grid: new Map() });
  a.place(0, 0);
  a.input.up = 1;
  ticks(a, 120);
  assert.equal(a.player.y, 3.7);
});

test('a separate flight envelope provides its own speed, floor and landing bounds', () => {
  const s = createSpaces({
    id: 'platform',
    bound: 2,
    ground: () => 3,
    flight: { cx: 4, cz: 0, bx: 10, bz: 10, ground: () => -2, ceiling: 12, speed: 6 },
  });
  const a = createPlayer(s, { eye: 1.5 });
  a.input.fly = a.input.run = true;
  a.input.right = a.input.up = 1;
  ticks(a, 240);
  assert.ok(Math.abs(a.player.vx - 12) < 1e-8);
  assert.equal(a.player.x, 14);
  assert.equal(a.player.y, 12);
  a.input.right = 0;
  a.input.up = -1;
  ticks(a, 240);
  assert.equal(a.player.y, -0.5);
  a.input.fly = false;
  ticks(a, 1);
  assert.equal(a.player.x, 2);
  assert.equal(a.player.y, 4.5);
});

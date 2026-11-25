import assert from 'node:assert/strict';
import test from 'node:test';
import { Bone, Group, Vector3 } from 'three';
import { createArmReach } from 'roamwright/motion/arm-reach.js';
test('a reachable grip hits a target in world space and an unreachable grip stops at its joint limit', () => {
  const reach = createArmReach({ elbowDirection: [0.6, -1, -0.2], minBend: -2.9, maxBend: -0.01 });
  const root = new Group(),
    arm = new Bone(),
    fore = new Bone(),
    hand = new Bone();
  root.add(arm);
  arm.add(fore);
  fore.add(hand);
  root.rotation.y = 0.4;
  root.position.x = 2;
  fore.position.y = -0.5;
  hand.position.y = -0.4;
  root.updateMatrixWorld(true);
  const origin = new Vector3(),
    target = new Vector3(2.3, -0.5, 0.3);
  reach(arm, fore, hand, origin, origin, target, 1, 1);
  assert.ok(hand.getWorldPosition(new Vector3()).distanceTo(target) < 1e-8);
  target.set(2, 30, 0);
  reach(arm, fore, hand, origin, origin, target, 1, 1);
  assert.ok(Math.abs(fore.rotation.x + 0.01) < 1e-10);
});

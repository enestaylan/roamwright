import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { createCasterMotion } from '../rendering/caster-motion.js';
import { createLightShafts } from '../rendering/light-shafts.js';

test('roof-constrained shafts keep their height and outdoor shafts rise above measured geometry', async () => {
  const scene = new Scene(), camera = new PerspectiveCamera();
  const group = new Group();
  group.position.set(2, 3, 4);
  scene.add(group);
  const requests = [];
  const shafts = createLightShafts({
    camera, ground: () => 3,
    heightProbe: async (...point) => { requests.push(point); return 24; },
    time: { value: 0 }, night: { value: 0 }, defaultHeight: 5, upperClearance: 2, probeRadius: 6,
    maxHeight: 30,
  });
  const color = new Color(0x9988ff);
  const open = shafts.lightShaft(color), roof = shafts.lightShaft(color, 4);
  group.add(open, roof);
  assert.equal(open.material, roof.material);
  shafts.updateShafts(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(requests, [[2, 3, 4, 6]]);
  shafts.updateShafts(1);
  assert.equal(open.scale.y, 23);
  assert.equal(roof.scale.y, 4);
});

test('shaft radii default to a wide foot and follow the foot and top options', () => {
  const options = { camera: new PerspectiveCamera(), ground: () => 0, heightProbe: async () => 0, time: { value: 0 }, night: { value: 0 } };
  const radii = shaft => {
    const p = shaft.geometry.getAttribute('position');
    let foot = 0, top = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (p.getY(i) < 0.5) foot = Math.max(foot, r);
      else top = Math.max(top, r);
    }
    return [+foot.toFixed(3), +top.toFixed(3)];
  };
  assert.deepEqual(radii(createLightShafts(options).lightShaft(new Color(0xffffff), 4)), [0.8, 0.35]);
  assert.deepEqual(radii(createLightShafts({ ...options, footRadius: 0.2, topRadius: 0.6 }).lightShaft(new Color(0xffffff), 4)), [0.2, 0.6]);
});

test('point-light caster signature follows instance version, reach and parent transform', () => {
  const scene = new Scene();
  const parent = new Group();
  const caster = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 1);
  caster.castShadow = true;
  caster.setMatrixAt(0, new Matrix4().makeTranslation(5, 0, 0));
  parent.add(caster);
  scene.add(parent);
  scene.updateMatrixWorld();
  const motion = createCasterMotion({ scene, elapsed: () => 0 });
  assert.equal(motion(0, 0, 0, 1), 0);
  const first = motion(0, 0, 0, 10);
  assert.notEqual(first, 0);
  assert.equal(motion(0, 0, 0, 10), first);
  parent.position.y = 3;
  scene.updateMatrixWorld();
  assert.notEqual(motion(0, 0, 0, 10), first);
  caster.setMatrixAt(0, new Matrix4().makeTranslation(15, 0, 0));
  caster.instanceMatrix.needsUpdate = true;
  assert.equal(motion(0, 0, 0, 10), 0);
});

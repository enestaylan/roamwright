import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createNoise, createRenderContext, createUnitShapes, GeometryBuilder, mulberry32 } from 'roamwright';
import { C, TRS } from 'roamwright/geometry/primitives.js';

const canvas = document.querySelector('canvas');
const { renderer, camera, scene, worldGroup } = createRenderContext(canvas, { fov: 41 });
const seed = Number(new URL(location.href).searchParams.get('seed') ?? 42) | 0;
const { fbm, ridged } = createNoise(seed);
const random = mulberry32(seed);
const shapes = createUnitShapes(fbm);
const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
const smoothstep = THREE.MathUtils.smoothstep;
const peaks = [
  // x, z, summit elevation and horizontal radius
  [-144, -112, 61, 86], [-91, -122, 78, 87], [-42, -142, 58, 76],
  [12, -119, 73, 65], [54, -134, 79, 76], [105, -107, 62, 74], [152, -138, 74, 79],
];
const channel = z => 8 * Math.sin(z * 0.067) + 5 * Math.sin(z * 0.029);

function elevation(x, z) {
  const bank = Math.abs(x - channel(z));
  const roughness = fbm(x * 0.065, z * 0.065, 4, 12);
  const foothills = smoothstep(bank, 5, 66) * (15 + 15 * roughness);
  let summit = 0;
  for (const [cx, cz, top, radius] of peaks) {
    summit = Math.max(summit, top * (1 - Math.hypot(x - cx, z - cz) / radius));
  }
  const folds = ridged(x * 0.045, z * 0.045, 4, 8);
  const mountains = summit + smoothstep(summit, 2, 28) * (16 * folds - 10);
  const valley = -2 + smoothstep(bank, 3, 15) * (3 + roughness * 4) + foothills;
  return Math.max(valley, mountains - 3);
}

// Color the same height field by elevation and slope. Steep faces retain exposed rock near the snowline.
const ground = new THREE.PlaneGeometry(390, 280, 320, 240).rotateX(-Math.PI / 2).translate(0, 0, -77);
const positions = ground.attributes.position;
for (let i = 0; i < positions.count; i++) positions.setY(i, elevation(positions.getX(i), positions.getZ(i)));
ground.computeVertexNormals();
const colors = new Float32Array(positions.count * 3);
const grass = new THREE.Color(0x819557), gravel = new THREE.Color(0xc6b690);
const rock = new THREE.Color(0x737b7f), snow = new THREE.Color(0xf1f4ec);
const tint = new THREE.Color();
for (let i = 0; i < positions.count; i++) {
  const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
  const grain = fbm(x * 0.16, z * 0.16, 3, 91);
  const up = ground.attributes.normal.getY(i);
  tint.copy(gravel).lerp(grass, smoothstep(y + grain * 2, 1, 6));
  tint.lerp(rock, Math.max(1 - smoothstep(up, 0.59, 0.84), smoothstep(y + grain * 6, 27, 40)));
  tint.lerp(snow, smoothstep(y + 29 * up + grain * 11, 68, 73));
  tint.multiplyScalar(0.78 + 0.35 * grain).toArray(colors, i * 3);
}
ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const hillside = new THREE.Mesh(ground, material);
hillside.receiveShadow = true;
worldGroup.add(hillside);

// A translucent surface lets the gravel bed show through along the banks.
const water = new THREE.Mesh(new THREE.PlaneGeometry(390, 280), new THREE.MeshStandardMaterial({
  color: 0x278786, transparent: true, opacity: 0.85, roughness: 0.45,
}));
water.rotation.x = -Math.PI / 2;
water.position.set(0, 0, -77);
water.receiveShadow = true;
worldGroup.add(water);

const structures = new GeometryBuilder();
const deck = 18, span = 12, radius = 4.7, spring = 10;
function extrude(shape, depth) {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -depth / 2);
}

// Reuse one arch profile in every span. A projecting ring of wedge stones follows its inner curve.
const arch = new THREE.Shape();
arch.moveTo(-span / 2, -3);
arch.lineTo(-radius, -3);
arch.absarc(0, spring, radius, Math.PI, 0, true);
arch.lineTo(radius, -3);
arch.lineTo(span / 2, -3);
arch.lineTo(span / 2, deck);
arch.lineTo(-span / 2, deck);
arch.closePath();
const archShape = extrude(arch, 4);
const wedge = new THREE.Shape();
const angle = Math.PI / 15;
wedge.moveTo(radius, 0);
wedge.lineTo(radius + 0.7, 0);
wedge.absarc(0, 0, radius + 0.7, 0, angle - 0.006, false);
wedge.absarc(0, 0, radius, angle - 0.006, 0, true);
wedge.closePath();
const wedgeShape = extrude(wedge, 4.2);
// Fit short courses around the arch opening, staggering the joints on each course.
function facing(x, row, left, right) {
  const bottom = row * 0.83;
  const offset = row % 2 === 0 ? 0 : 1.1;
  for (let joint = -span / 2 - offset; joint < right; joint += 2.2) {
    const a = Math.max(left, joint), b = Math.min(right, joint + 2.2);
    if (b - a < 0.12) continue;
    structures.box(x + (a + b) / 2, bottom, 0, b - a - 0.035, 0.79, 4.04, C(0xbca68b, 0.07, random));
  }
}
for (let x = -42; x <= 42; x += span) {
  structures.add(archShape, C(0xb19c7d), TRS(x, 0, 0));
  for (let row = 0; (row + 1) * 0.83 <= deck; row++) {
    const rise = Math.max(0, row * 0.83 - spring);
    const opening = Math.sqrt(Math.max(0, (radius + 0.5) ** 2 - rise ** 2));
    facing(x, row, -span / 2, -opening);
    facing(x, row, opening, span / 2);
  }
  for (let i = 0; i < 15; i++) {
    structures.add(wedgeShape, C(0xd0b99a, 0.12, random), TRS(x, spring, 0, 1, 1, 1, 0, 0, i * angle));
  }
}
structures.box(0, deck, 0, 96, 0.45, 4.6, C(0xd8c5a4));
for (const z of [-2, 2]) structures.box(0, deck + 0.45, z, 96, 0.55, 0.3, C(0x9d8972));
for (const z of [-0.8, 0.8]) structures.box(0, deck + 0.45, z, 96, 0.18, 0.12, C(0x414342));

// The cars, window frames, rails and masonry all share one geometry and material.
for (const x of [-14, -5, 4, 13]) {
  structures.box(x, deck + 0.66, 0, 7.8, 0.52, 2.4, C(0x343a3a));
  structures.box(x, deck + 1.18, 0, 8.6, 2.65, 2.8, C(0xab3127));
  structures.box(x, deck + 2.22, 0, 8.62, 1.22, 2.82, C(0xf4d9a5));
  for (let offset = -3; offset <= 3; offset += 1.5) {
    structures.box(x + offset, deck + 2.36, 0, 1.1, 0.85, 2.86, C(0x29444b));
  }
  structures.box(x, deck + 3.83, 0, 8.8, 0.23, 2.95, C(0x555a59));
  structures.box(x, deck + 4.06, 0, 8.3, 0.12, 2.65, C(0x727875));
  for (const end of [-3, 3]) {
    structures.box(x + end, deck + 4.18, 0, 0.9, 0.16, 1.2, C(0x45494a));
    structures.add(shapes.cyl, C(0x252b30), TRS(x + end, deck + 0.95, -1.23, 0.71, 2.46, 0.71, 0, Math.PI / 2));
  }
  structures.box(x, deck + 1.43, 0, 8.62, 0.12, 2.84, C(0xe3bc83));
}
structures.mesh(material, worldGroup);

// Reuse the terrain sampler for placement so trees and boulders follow each new seed.
const woodland = new GeometryBuilder();
for (let i = 0; i < 4100; i++) {
  const x = random() * 220 - 110, z = random() * 162 - 111;
  const y = elevation(x, z);
  if (y < 2 || y > 35 || (Math.abs(z) < 4 && Math.abs(x) < 55)) continue;
  const size = 2.2 + random() * 4.1;
  const yaw = random() * Math.PI;
  woodland.box(x, y - 0.4, z, size * 0.09, size * 0.6, size * 0.09, C(0x594530));
  const needles = C(random() > 0.45 ? 0x365e4b : 0x43694e, 0.2, random);
  woodland.add(shapes.cone6, needles, TRS(x, y + size * 0.13, z, size * 0.55, size * 0.63, size * 0.55, yaw));
  woodland.add(shapes.cone6, needles, TRS(x, y + size * 0.43, z, size * 0.39, size * 0.58, size * 0.39, yaw + 0.4));
}
for (let i = 0; i < 520; i++) {
  const z = random() * 155 - 100, x = channel(z) + (random() - 0.5) * 29;
  const size = 0.45 + random() * 2.7;
  woodland.add(shapes.rock, C(0x858884, 0.22, random), TRS(x, elevation(x, z), z, size * 1.4, size, size, random() * Math.PI));
}
woodland.mesh(material, worldGroup);

const sky = document.createElement('canvas');
sky.width = 1;
sky.height = 256;
const paint = sky.getContext('2d');
const gradient = paint.createLinearGradient(0, 0, 0, sky.height);
gradient.addColorStop(0, '#91bcd4');
gradient.addColorStop(0.58, '#e3e8df');
paint.fillStyle = gradient;
paint.fillRect(0, 0, 1, sky.height);
scene.background = new THREE.CanvasTexture(sky);
scene.background.colorSpace = THREE.SRGBColorSpace;
scene.fog = new THREE.FogExp2(0xc9d8dd, 0.0042);
scene.add(new THREE.HemisphereLight(0xfff2d8, 0x9cb1c1, 1.35));
const sun = new THREE.DirectionalLight(0xffe1b2, 2.45);
sun.position.set(-58, 76, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 72, bottom: -72, near: 1, far: 195 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = 0.055;
// Only the camera moves, so each orbit can reuse the first shadow map.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
scene.add(sun);

camera.position.set(28, 29, 78);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 18, -11);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 14;
controls.maxDistance = 135;
function draw() {
  renderer.render(scene, camera);
}
controls.addEventListener('change', draw);
function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  controls.update();
  draw();
}
window.addEventListener('resize', resize);
resize();

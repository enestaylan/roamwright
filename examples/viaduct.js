import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createNoise, createRenderContext, createUnitShapes, GeometryBuilder, mulberry32 } from 'roamwright';
import { heightfieldSampler } from 'roamwright/geometry/heightfield.js';
import { createCameraGuard } from './viaduct-camera.js';
import { alpineRiver, branchWhorl, valleySky } from './viaduct-landscape.js';
import { C, stick, TRS } from 'roamwright/geometry/primitives.js';

const canvas = document.querySelector('canvas');
const { renderer, camera, scene, worldGroup } = createRenderContext(canvas, { fov: 41 });
const seed = Number(new URL(location.href).searchParams.get('seed') ?? 42) | 0;
const noise = createNoise(seed);
const { fbm, ridged } = noise;
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
    const dx = x - cx, dz = z - cz;
    const angle = Math.atan2(dz, dx);
    const spine = 1 + 0.19 * Math.cos(angle * 3 + cx) + 0.12 * Math.sin(angle * 5 + cz);
    summit = Math.max(summit, top * (1 - Math.hypot(dx, dz) / (radius * spine)));
  }
  const folds = ridged(x * 0.045, z * 0.045, 4, 8);
  const mountains = summit + smoothstep(summit, 2, 28) * (21 * folds - 13);
  const valley = -2 + smoothstep(bank, 3, 15) * (3 + roughness * 4) + foothills;
  let height = Math.max(valley, mountains - 3);
  // A level rail cutting ends at the two tunnel mouths. Rock covers the train beyond them.
  const end = Math.abs(x);
  const corridor = smoothstep(end, 35, 46) * (1 - smoothstep(Math.abs(z), 3.1, 9));
  const cutting = THREE.MathUtils.lerp(18, 29, smoothstep(end, 52, 57));
  height += (cutting - height) * corridor;
  return height;
}

// Color the same height field by elevation and slope. Steep faces retain exposed rock near the snowline.
const ground = new THREE.PlaneGeometry(390, 385, 320, 330).rotateX(-Math.PI / 2).translate(0, 0, -24.5);
const positions = ground.attributes.position;
for (let i = 0; i < positions.count; i++) positions.setY(i, elevation(positions.getX(i), positions.getZ(i)));
ground.computeVertexNormals();
const colors = new Float32Array(positions.count * 3);
const grass = new THREE.Color(0x839062), gravel = new THREE.Color(0xc6b690);
const rock = new THREE.Color(0x6d7377), snow = new THREE.Color(0xf3efe4);
const tint = new THREE.Color();
for (let i = 0; i < positions.count; i++) {
  const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
  const grain = fbm(x * 0.16, z * 0.16, 3, 91);
  const bedding = Math.cos(y * 1.8 + x * 0.44 + 5 * grain);
  const up = ground.attributes.normal.getY(i);
  tint.copy(gravel).lerp(grass, smoothstep(y + grain * 2, 1, 6));
  tint.lerp(rock, Math.max(1 - smoothstep(up, 0.59, 0.84), smoothstep(y + grain * 6, 27, 40)));
  tint.multiplyScalar(1 - 0.24 * smoothstep(y, 28, 41) * smoothstep(bedding, 0.1, 0.94));
  tint.lerp(snow, smoothstep(y + 36 * up + grain * 14, 80, 89));
  tint.multiplyScalar(0.78 + 0.35 * grain).toArray(colors, i * 3);
}
ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const hillside = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }));
hillside.receiveShadow = true;
worldGroup.add(hillside);

worldGroup.add(alpineRiver(channel, elevation, noise));

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
structures.box(0, deck + 0.42, 0, 112, 0.13, 3, C(0x776554));
for (let x = -55; x <= 55; x += 0.9) structures.box(x, deck + 0.55, 0, 0.21, 0.11, 2.35, C(0x624e3c));
for (const z of [-0.8, 0.8]) structures.box(0, deck + 0.66, z, 112, 0.18, 0.12, C(0x414342));

const tunnel = new THREE.Shape();
tunnel.moveTo(-radius, -3);
tunnel.absarc(0, spring, radius, Math.PI, 0, true);
tunnel.lineTo(radius, -3);
tunnel.closePath();
const tunnelInterior = extrude(tunnel, 0.25);
const portalBase = deck - 4.5;
// Scale a copy of the stone arch around each tunnel entrance, perpendicular to the bridge.
for (const side of [-1, 1]) {
  structures.add(tunnelInterior, C(0x252a27), TRS(side * 55, portalBase, 0, 0.59, 0.77, 1, side * Math.PI / 2));
  structures.add(archShape, C(0x917d67), TRS(side * 53, portalBase, 0, 0.59, 0.77, 1, side * Math.PI / 2));
  for (let i = 0; i < 15; i++) {
    const matrix = TRS(side * 53, portalBase + spring * 0.77, 0, 0.59, 0.77, 1, side * Math.PI / 2).clone();
    matrix.multiply(new THREE.Matrix4().makeRotationZ(i * angle));
    structures.add(wedgeShape, C(0xbda884), matrix);
  }
}
// Cantilevers keep the contact wire above the track. Only the upper cable sags.
const iron = C(0x475550), copper = C(0x554634);
for (let x = -48; x <= 48; x += 16) {
  const foot = deck + 1;
  structures.box(x, foot, -2, 0.19, 6.4, 0.19, iron);
  stick(structures, [x, foot + 5.45, -2], [x, foot + 6.2, 0.5], 0.105, iron);
  stick(structures, [x, foot + 4.7, -2], [x, foot + 6.12, 0.25], 0.08, iron);
  if (x === 48) continue;
  stick(structures, [x, foot + 5.35, 0], [x + 16, foot + 5.35, 0], 0.042, copper);
  stick(structures, [x, foot + 6.08, 0], [x + 8, foot + 5.68, 0], 0.05, copper);
  stick(structures, [x + 8, foot + 5.68, 0], [x + 16, foot + 6.08, 0], 0.05, copper);
  stick(structures, [x + 8, foot + 5.35, 0], [x + 8, foot + 5.68, 0], 0.035, iron);
}
structures.mesh(material, worldGroup);

// The four cars travel together as one mesh, independently of the cached bridge shadows.
const carriages = new GeometryBuilder();
const roofProfile = new THREE.Shape();
roofProfile.moveTo(-1.48, 0);
roofProfile.lineTo(1.48, 0);
roofProfile.quadraticCurveTo(1.43, 0.38, 0.95, 0.4);
roofProfile.lineTo(-0.95, 0.4);
roofProfile.quadraticCurveTo(-1.43, 0.38, -1.48, 0);
const roof = extrude(roofProfile, 8.8).rotateY(Math.PI / 2);
for (const x of [-14, -5, 4, 13]) {
  carriages.box(x, deck + 0.66, 0, 7.8, 0.52, 2.4, C(0x343a3a));
  carriages.box(x, deck + 1.18, 0, 8.6, 2.65, 2.8, C(0x9e2824));
  carriages.box(x, deck + 2.22, 0, 8.62, 1.22, 2.82, C(0xf4d9a5));
  for (let offset = -3; offset <= 3; offset += 1.5) {
    carriages.box(x + offset, deck + 2.36, 0, 1.1, 0.85, 2.86, C(0x344e54));
    carriages.box(x + offset, deck + 2.96, 0, 1.10, 0.22, 2.865, C(0x6c878b));
  }
  carriages.add(roof, C(0x646b68), TRS(x, deck + 3.83, 0));
  for (const end of [-3, 3]) {
    carriages.box(x + end, deck + 4.18, 0, 0.9, 0.16, 1.2, C(0x45494a));
    carriages.add(shapes.cyl, C(0x252b30), TRS(x + end, deck + 0.95, -1.23, 0.71, 2.46, 0.71, 0, Math.PI / 2));
  }
  for (const door of [-3.92, 3.92]) {
    carriages.box(x + door, deck + 1.27, 0, 0.58, 2.37, 2.84, C(0x872c28));
    carriages.box(x + door, deck + 2.47, 0, 0.36, 0.78, 2.87, C(0x33484a));
  }
  carriages.box(x, deck + 1.43, 0, 8.62, 0.12, 2.84, C(0xe3bc83));
}
carriages.box(17.32, deck + 2.42, 0, 0.12, 0.92, 2.1, C(0x34494c));
for (const z of [-1, 1]) carriages.box(17.34, deck + 1.66, z, 0.15, 0.32, 0.32, C(0xffda89));
// A sprung pickup connects the leading car to the contact wire.
for (const z of [-0.32, 0.32]) {
  stick(carriages, [10.9, deck + 4.24, z], [12.25, deck + 5.28, z], 0.10, iron);
  stick(carriages, [12.25, deck + 5.28, z], [11.4, deck + 6.30, z], 0.085, iron);
}
carriages.box(11.4, deck + 6.28, 0, 0.22, 0.07, 1.45, C(0x383c39));
const train = carriages.mesh(material, worldGroup, false);

// Reuse the terrain sampler for placement so trees and boulders follow each new seed.
const woodland = new GeometryBuilder();
const groundAt = heightfieldSampler(ground);
const treeCrowns = [];
const whorl = branchWhorl();
for (let i = 0; i < 3300; i++) {
  const x = random() * 220 - 110, z = random() * 162 - 111;
  const y = groundAt(x, z);
  if (y < 2 || y > 35 || (Math.abs(z) < 4 && Math.abs(x) < 58)) continue;
  const size = 2.2 + random() * 4.2;
  const yaw = random() * Math.PI;
  const larch = noise.vnoise(x * 0.09, z * 0.09, 93) + random() * 0.30 > 0.92;
  const needles = larch ? 0xa88938 : 0x325b4b;
  const halfTrunk = size * 0.065 / 2;
  const root = Math.min(groundAt(x - halfTrunk, z - halfTrunk), groundAt(x - halfTrunk, z + halfTrunk),
    groundAt(x + halfTrunk, z - halfTrunk), groundAt(x + halfTrunk, z + halfTrunk), y) - 0.25;
  woodland.box(x, root, z, halfTrunk * 2, y + size * 0.7 - root, halfTrunk * 2, C(0x5b4738));
  treeCrowns.push({ x, z, top: y + size * 1.09, radius: size * 0.28 });
  for (let tier = 0; tier < 3; tier++) {
    const width = size * (0.54 - tier * 0.105);
    woodland.add(whorl, C(needles, 0.18, random), TRS(x, y + size * (0.12 + tier * 0.23), z, width, size * 0.51, width, yaw + tier * 0.71));
  }
}
for (let i = 0; i < 520; i++) {
  const z = random() * 155 - 100, x = channel(z) + (random() - 0.5) * 29;
  const bed = groundAt(x, z);
  if (bed > 5) continue;
  const size = 0.4 + random() * 2.05;
  woodland.add(shapes.rock, C(0x858884, 0.22, random), TRS(x, bed, z, size * 1.4, size, size, random() * Math.PI));
}
woodland.mesh(material, worldGroup);

scene.background = valleySky(noise);
scene.fog = new THREE.FogExp2(0xcac8bb, 0.0042);
scene.add(new THREE.HemisphereLight(0xffefda, 0x9eafba, 1.55));
const sun = new THREE.DirectionalLight(0xffdfb2, 2.45);
sun.position.set(-65, 53, 37);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 72, bottom: -72, near: 1, far: 195 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = 0.055;
// Trees and masonry cast the static shadow map once.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
scene.add(sun);

const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 6;
controls.maxDistance = 135;

const viewpoints = {
  valley:    { eye: [31, 29, 82], target: [0, 17, -9] },
  trackside: { eye: [29, 25, 14], target: [1, 20.5, 0] },
  riverbank: { eye: [13, 5.3, 38], target: [-2, 11.8, -6] },
};
const viewButtons = document.querySelectorAll('[data-view]');
function draw() {
  renderer.render(scene, camera);
}
const guardCamera = createCameraGuard(ground, treeCrowns);
function drawCamera() {
  guardCamera(camera);
  camera.lookAt(controls.target);
  draw();
}
controls.addEventListener('change', drawCamera);
function selectView(name) {
  const { eye, target } = viewpoints[name];
  controls.target.fromArray(target);
  camera.position.fromArray(eye);
  controls.update();
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  draw();
}
viewButtons.forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
document.querySelector('#seed').value = seed;

// Give keyboard explorers the same orbit and zoom gestures as pointer users.
canvas.addEventListener('keydown', event => {
  const offset = camera.position.clone().sub(controls.target);
  const orbit = new THREE.Spherical().setFromVector3(offset);
  switch (event.key) {
    case 'ArrowLeft': orbit.theta -= 0.10; break;
    case 'ArrowRight': orbit.theta += 0.10; break;
    case 'ArrowUp': orbit.phi -= 0.08; break;
    case 'ArrowDown': orbit.phi += 0.08; break;
    case '+': case '=': orbit.radius *= 0.88; break;
    case '-': orbit.radius /= 0.88; break;
    default: return;
  }
  event.preventDefault();
  camera.position.setFromSpherical(orbit.makeSafe()).add(controls.target);
  controls.update();
});

const trainButton = document.querySelector('#train');
const trainLabel = document.querySelector('#train-label');
let running = false, frame = 0, lastTime = 0;
function moveTrain(time) {
  const elapsed = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
  lastTime = time;
  train.position.x += elapsed * 6;
  if (train.position.x >= 80) train.position.x -= 160;
  train.updateMatrix();
  draw();
  frame = requestAnimationFrame(moveTrain);
}
function scheduleTrain() {
  cancelAnimationFrame(frame);
  lastTime = 0;
  if (running && !document.hidden) frame = requestAnimationFrame(moveTrain);
}
trainButton.addEventListener('click', () => {
  running = !running;
  trainLabel.textContent = running ? 'Pause train' : 'Run train';
  trainButton.firstElementChild.textContent = running ? 'Ⅱ' : '▶';
  scheduleTrain();
});
document.addEventListener('visibilitychange', scheduleTrain);

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  // Keep the train and several arches in frame on a narrow screen.
  camera.fov = THREE.MathUtils.clamp(41 / Math.min(camera.aspect, 1), 41, 69);
  camera.updateProjectionMatrix();
  drawCamera();
}
window.addEventListener('resize', resize);
selectView('valley');
resize();

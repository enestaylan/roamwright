import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createNoise, createRenderContext, mulberry32, GeometryBuilder } from 'roamwright';

const canvas = document.querySelector('canvas');
const { renderer, camera, scene, worldGroup } = createRenderContext(canvas);
const seed = Number(new URL(location.href).searchParams.get('seed') ?? 42);
const { fbm } = createNoise(seed);
const random = mulberry32(seed);
const terrain = new THREE.PlaneGeometry(100, 100, 144, 144).rotateX(-Math.PI / 2);
const position = terrain.getAttribute('position');
const colors = new Float32Array(position.count * 3);
const color = new THREE.Color();
const height = (x, z) => {
  const radius = Math.hypot(x * 0.96, z * 1.15) / 47;
  return (1 - radius) * 18 + (fbm(x * 0.079, z * 0.079, 5, 7) - 0.5) * 12 - 3;
};
for (let i = 0; i < position.count; i++) {
  const y = height(position.getX(i), position.getZ(i));
  position.setY(i, y);
  color.setHex(y < 1.2 ? 0xd3c295 : y < 9 ? 0x738c61 : 0x8b8b80);
  color.multiplyScalar(0.88 + 0.17 * random()).toArray(colors, i * 3);
}
terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3));
terrain.computeVertexNormals();
worldGroup.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true })));
const stones = new GeometryBuilder();
for (let i = 0; i < 100; i++) {
  const x = (random() - 0.5) * 75, z = (random() - 0.5) * 75;
  const y = height(x, z), width = 0.3 + random() * 1.5;
  if (y > 1) stones.box(x, y - 0.35, z, width, width * 1.3, width, [0.22, 0.25, 0.23], random() * Math.PI, 0.15);
}
stones.mesh(new THREE.MeshStandardMaterial({ vertexColors: true }), worldGroup, false);
const water = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0x397988 }));
water.rotation.x = -Math.PI / 2;
worldGroup.add(water);
scene.background = new THREE.Color(0xbad2d9);
scene.fog = new THREE.FogExp2(scene.background, 0.006);
scene.add(new THREE.HemisphereLight(0xffffff, 0x737759, 1.8));
const sun = new THREE.DirectionalLight(0xffebcc, 2.4);
sun.position.set(-1, 1.4, 0.7);
scene.add(sun);
camera.position.set(60, 39, 65);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 3, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 10;
controls.maxDistance = 130;
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

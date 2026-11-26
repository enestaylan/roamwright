**Roamwright is a procedural worldbuilding engine for Three.js.** You describe how high the ground rises, where water runs and what can grow on a slope. Roamwright gives you functions for building and querying that world. Three.js draws it. You can use those functions in an existing scene or start one with Roamwright’s rendering context.

[Explore the alpine viaduct](https://enestaylan.github.io/roamwright/examples/viaduct.html?seed=42). From the riverbank, look at where the piers meet the ground and where trees give way to exposed rock. The landscape provides both the visible mesh and the heights that guide placement.

## How a world fits together

Three.js uses Y for height. On a map viewed from above, X and Z locate a point and a **height field** gives the ground elevation there. A **seed** selects a repeatable pattern. With the same seed, coordinates and generation settings, you can rebuild the same hills.

```text
seed + landscape rules
          |
          v
   terrain vertices -----> ground mesh -----------------+
          |                                              |
          v                                              v
   height at (x, z) ---> place trees and buildings ---> scene
          |                                              |
          +-----------> ground beneath the player        v
                                                   camera view
```

A mesh joins its vertices with flat triangles. Between vertices, a noise formula can give a slightly different height from the triangle on screen. To seat a bridge pier exactly on a rendered slope, generate the vertices first and then query the mesh with {@link geometry/heightfield!heightfieldSampler | heightfieldSampler}.

## Find the module you need

| When you want to… | Start here |
| --- | --- |
| Rebuild the same landscape from a seed | {@link math/noise!createNoise | createNoise} samples a pattern by location. {@link math/random!mulberry32 | mulberry32} gives a repeatable sequence for choices such as tree sizes. |
| Shape terrain and water | {@link math/mountain-ranges!createMountainRanges | createMountainRanges} adds relief to ground heights. {@link geometry/stream!streamGeometry | streamGeometry} turns a downstream path and water elevations into a river ribbon. |
| Build and place scenery | {@link geometry/builder!GB | GeometryBuilder} collects coloured pieces into a mesh. {@link geometry/scatter-grid!createScatterGrid | createScatterGrid} generates repeatable placement candidates around a moving observer. |
| Walk through the world | {@link motion/spaces!createSpaces | createSpaces} holds ground, deck and collision queries. {@link motion/player!createPlayer | createPlayer} uses them to move the player and position the camera. |
| Add weather | {@link motion/weather!createWeather | createWeather} advances rain, dampness and mist. |
| Generate large worlds in the background | {@link runtime/pool!createPool | createPool} distributes jobs to workers. |

Core entry points such as `GeometryBuilder` and `createNoise` are available from `roamwright`. For a specialised function, use the module path, for example `roamwright/geometry/heightfield.js`. The {@link index | package entry point} lists the core exports.

## Build a hillside and place three posts

This small scene shows the full path from a seed to something you can inspect. The terrain uses a grid of triangles, and each post’s base sits at the height of the triangle beneath it. Drag to orbit and scroll to zoom.

In an empty directory with Node.js 24 and npm installed, run these commands.

```sh
npm install roamwright three@0.187.0
npm install --save-dev vite
```

Save this as `index.html`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Roamwright hillside</title>
  <style>body { margin: 0 } canvas { display: block; width: 100vw; height: 100dvh }</style>
</head>
<body>
  <canvas aria-label="Three posts on a seeded hillside"></canvas>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

Save the scene in `main.js` alongside it.

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createNoise, createRenderContext, GeometryBuilder } from 'roamwright';
import { heightfieldSampler } from 'roamwright/geometry/heightfield.js';

const canvas = document.querySelector('canvas');
const { renderer, scene, camera, worldGroup } = createRenderContext(canvas);
const { fbm } = createNoise(42);

// Sample the terrain once per vertex. Smaller input frequencies make broader hills.
const terrain = new THREE.PlaneGeometry(40, 40, 32, 32).rotateX(-Math.PI / 2);
const positions = terrain.getAttribute('position');
for (let i = 0; i < positions.count; i++) {
  const x = positions.getX(i), z = positions.getZ(i);
  positions.setY(i, 8 * fbm(x / 18, z / 18, 4, 7));
}
terrain.computeVertexNormals();
worldGroup.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ color: 0x739362 })));

// Sample the finished mesh anywhere on the hillside, including between vertices.
const groundAt = heightfieldSampler(terrain);
const posts = new GeometryBuilder();
for (const [x, z] of [[-7, -3], [0, 1], [6, 4]]) {
  posts.box(x, groundAt(x, z), z, 0.8, 4, 0.8, [0.55, 0.24, 0.08]);
}
posts.mesh(new THREE.MeshStandardMaterial({ vertexColors: true }), worldGroup);

scene.background = new THREE.Color(0xc9dce4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x897357, 2));
const sun = new THREE.DirectionalLight(0xfff1d0, 2);
sun.position.set(10, 18, 7);
scene.add(sun);

camera.position.set(29, 23, 31);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 4, 0);
controls.update();

function draw() {
  renderer.render(scene, camera);
}
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  draw();
}
controls.addEventListener('change', draw);
window.addEventListener('resize', resize);
resize();
```

Run `npx vite` and open the local address it prints. Change `42` to another seed to reshape the hill. The posts keep their X/Z locations and settle at new elevations. To see the same technique used for trees, rock and rail, explore the [alpine viaduct source](https://github.com/enestaylan/roamwright/blob/main/examples/viaduct.js).

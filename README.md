# Roamwright

[![npm version](https://img.shields.io/npm/v/roamwright)](https://www.npmjs.com/package/roamwright)
[![Compatibility tests](https://github.com/enestaylan/roamwright/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/enestaylan/roamwright/actions/workflows/test.yml)

Roamwright is a Three.js library for building procedural worlds you can explore on foot or in flight. Generate terrain from a seed, batch scenery into meshes, and use the same terrain to guide movement through the world in your browser. For larger worlds, a worker pool can build geometry off the main thread.

![A red passenger train on a stone viaduct above a winding alpine river, with conifers on the banks and snow on the peaks](https://raw.githubusercontent.com/enestaylan/roamwright/main/docs/alpine-viaduct.jpg)

**Alpine viaduct, seed 42.** One height field shapes the riverbed and snowy ridges and determines where the conifers take root. Eight copies of an arch profile form the viaduct. Its stonework, rails and four passenger cars share one mesh. [Explore the example source](examples/viaduct.js).

## Install

```sh
npm install roamwright
```

npm resolves the Three.js peer in a new project. If you already use Three.js, the supported versions are **0.170.0** and **0.187.0**. To select one explicitly, run `npm install roamwright three@0.187.0`. The renderer requires WebGL 2.

## Run the examples

With Node.js, npm and Python 3 installed, run the following commands.

```sh
git clone https://github.com/enestaylan/roamwright.git
cd roamwright
npm ci
npm run demo
```

| Example | What to look for |
| --- | --- |
| [Alpine viaduct](http://localhost:8080/examples/viaduct.html?seed=42) | Follow the river under the arches. Change the seed to see how the treeline, exposed rock and shoreline follow the terrain. [Source](examples/viaduct.js) |
| [Seeded island](http://localhost:8080/examples/?seed=42) | Start with a smaller scene that uses noise to shape a coastline and a single mesh for its scattered rocks. [Source](examples/island.js) · [Render](https://raw.githubusercontent.com/enestaylan/roamwright/main/docs/seeded-island.jpg) |

Drag to orbit and scroll or pinch to zoom. Both examples load Three.js from your local installation. Set the integer after `?seed=` to reproduce a landscape.

## Render your first mesh

Use an ES module bundler, or provide a browser import map as in the example. Supply a canvas with a CSS width and height.

```js
import * as THREE from 'three';
import { createRenderContext, GeometryBuilder } from 'roamwright';

const canvas = document.querySelector('canvas');
const { renderer, scene, camera, worldGroup } = createRenderContext(canvas);
const blocks = new GeometryBuilder();
blocks.box(0, 0, 0, 2, 3, 2, [0.3, 0.55, 0.44]);
blocks.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), worldGroup, false);

renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
camera.aspect = canvas.clientWidth / canvas.clientHeight;
camera.updateProjectionMatrix();
camera.position.set(6, 4, 6);
camera.lookAt(0, 1, 0);
renderer.render(scene, camera);
```

## Modules

| Import from `roamwright/` | Use |
| --- | --- |
| `math/noise.js`, `math/random.js`, `math/curve.js` | Create independent seeded noise fields, resumable random streams and evenly spaced spline samples. These modules also run in workers. |
| `geometry/builder.js`, `geometry/primitives.js` | Transform and merge primitives, produce typed vertex buffers, or build a Three.js mesh. Colors passed to the builder are linear RGB. |
| `geometry/terrain-extension.js` | Extend an XZ grid to the horizon with concentric rings. `terrainExtension({ size, segments, reach, centerX, centerZ, growth })` returns transferable positions, triangle indices and the source grid index of each vertex on the inner boundary. Sample your height and shading at those positions. |
| `geometry/heightfield.js` | Sample a regular X/Z Three.js plane at its rendered triangle height with `heightfieldSampler(geometry, outside)`. Use `refineHeightfield(base, { x, z, cells, subdivisions, height, createPatch })` to replace a square of cells during construction. The callback receives the snapped center, width, depth, segment count and edge-matched height function. Return the new plane geometry in the base's coordinate system. The returned sampler covers both resolutions and uses `height` outside the base. |
| `geometry/instances.js`, `rendering/piece-batch.js` | Draw repeated geometry with instancing or collect changing pieces into a GPU batch. |
| `math/color.js` | Convert 8-bit sRGB channels with the `SRGB2LIN` lookup, scale linear RGB triples with `dim`, or apply the Three.js ACES fit to a color with `acesToColor(color, exposure)`. |
| `runtime/grid-rows.js` | Split typed grids with `cutRows(grids, rows, start, end)` and reassemble independently completed bands with `pasteRows(grids, rows, start, bands)`. Each grid may have a different number of values per row. |
| `rendering/contact-shadows.js` | Add a `ContactShadows({ capacity, opacity, lift })` mesh to a scene. Each frame call `begin()`, `add(x, receiverY, z, radius, intensity)` for each contact, then `end()`. All contacts share one draw. Call `dispose()` when finished. |
| `motion/spaces.js`, `motion/player.js` | Give a space terrain height, decks and colliders. Set the controller's input axes, call `update(deltaSeconds)`, then `applyCamera(camera)`. Distances are in metres. |
| `runtime/pool.js`, `runtime/worker.js` | Register named jobs on a module worker and send work from the page. Typed-array buffers in results transfer back to the caller. |
| `rendering/context.js`, `rendering/world-matrices.js` | Set up WebGL2, a camera, a scene and world group. Optionally track static transforms once per frame before drawing. |
| `rendering/post.js`, `rendering/taa.js`, `rendering/dof.js` | Compose HDR passes, temporal antialiasing, depth of field, exposure and upscaling. The application supplies its camera, effect scene and sky occlusion mask. |
| `runtime/gpu-timing.js`, `runtime/quality-fit.js`, `runtime/quality-store.js` | Measure GPU work, adapt quality and persist a visitor's settings in a storage namespace chosen by the application. |

For geometry generated off the main thread, call `builder.parts(true)` in the worker and `geometryOf(parts)` on the page. This path frees static CPU-side attributes after upload. Keep the seed or source data if your application needs to regenerate meshes after a context loss.

## Contributing and license

See the [contributor guide](CONTRIBUTING.md) for local checks and release instructions. Use [GitHub Issues](https://github.com/enestaylan/roamwright/issues) for bugs and feature requests, or [report a vulnerability privately](https://github.com/enestaylan/roamwright/security/advisories/new).

Roamwright is distributed under the [MIT license](LICENSE). Notices for adapted components are in [licenses](licenses).

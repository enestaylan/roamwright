# Roamwright

[![npm version](https://img.shields.io/npm/v/roamwright)](https://www.npmjs.com/package/roamwright)
[![Compatibility tests](https://github.com/enestaylan/roamwright/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/enestaylan/roamwright/actions/workflows/test.yml)

Roamwright is a procedural worldbuilding engine built on top of Three.js. It gives you reusable systems for turning a 3D scene into a world you can explore. You define the landscape once and use the same terrain to shape riverbanks, place scenery and guide characters over uneven ground. First-person walking and flight, crowd animation, weather and day–night lighting can all be used in your own Three.js scene.

![A red passenger train on a stone viaduct above a winding alpine river, with conifers on the banks and snow on the peaks](https://raw.githubusercontent.com/enestaylan/roamwright/main/docs/alpine-viaduct.jpg)

**Alpine viaduct.** One height field shapes the riverbed and snowy ridges and determines where the conifers take root. Eight copies of an arch profile form the viaduct. The stonework, rails and overhead wires share one mesh. The four-car electric train moves as a separate mesh. Choose Valley, Trackside or Riverbank and select **Run train** to watch it cross. [Explore the example source](examples/viaduct.js).

## Building an explorable world

- **Landscapes and structures.** Generate repeatable mountain ranges, eroded slopes and rock outcrops. Terrain-aware placement keeps scenery on the ground. Buildings and bridges can use modular geometry and tileable stone, timber and roof textures.
- **Water, light and weather.** Rivers support directional flow, lakes support reflections, and water surfaces respond to rain with ripples. Volumetric clouds, sun and moon cycles, wind and haze let the same landscape take on different weather and lighting conditions.
- **Characters and exploration.** Bipeds and quadrupeds have procedural gaits, and crowds can follow daily routes. First-person movement covers walking, jumping and flight, including collision checks and support for raised surfaces such as bridge decks.
- **Large scenes.** Background geometry generation, batched scenery, instanced crowds, distance-based levels of detail and adaptive rendering quality help manage the cost of dense forests, crowds and long views.

## Install

```sh
npm install roamwright
```

npm resolves the Three.js peer in a new project. If you already use Three.js, the supported versions are **0.170.0** and **0.187.0**. To select one explicitly, run `npm install roamwright three@0.187.0`. The renderer requires WebGL 2.

## Built with Roamwright

[Malazan](https://enestaylan.com/malazan/) is an explorable world built with Roamwright. Fly over Darujhistan, Pale, and the Rhivi Plain from *Malazan Book of the Fallen*.

The shader compilation schedule accepts a subtree or an array of disjoint subtrees in one lighting environment. During a loading screen, `await warmShaders(roots, {blocking: true})` passes the blocking flag to `beginCompiles(root, warmed, blocking)` so the application can submit the batch in parallel. The default keeps the application’s incremental scheduling during play.

## Examples

| Live example | What the example shows | Source |
| --- | --- | --- |
| [Alpine viaduct](https://enestaylan.github.io/roamwright/examples/viaduct.html) | Watch an electric train cross eight stone arches from the valley, trackside or riverbank. | [viaduct.js](examples/viaduct.js) |
| [Seeded island](https://enestaylan.github.io/roamwright/examples/?seed=42) | Seeded noise shapes the coastline, and a single mesh holds the rocks scattered along the shore. | [island.js](examples/island.js) |

### Run locally

With Node.js, npm and Python 3 installed, run the following commands.

```sh
git clone https://github.com/enestaylan/roamwright.git
cd roamwright
npm ci
npm run demo
```

Open the address printed in the terminal for the example you want to explore. Drag to orbit and scroll or pinch to zoom. Change the integer after `?seed=` to generate a different landscape.

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

Import any module from `roamwright/<folder>/<name>.js`. Each area below names its main modules first. Its other modules are listed after them. See each module’s source for its parameters, and the [tests](test) and browser fixtures for complete setups.

| Area | Main modules | Also includes |
| --- | --- | --- |
| Foundations | `math/noise.js`, `math/random.js`, `math/curve.js` and `math/color.js` provide seeded noise, resumable random streams, spline samples and colour conversion. They also run in workers. | `math/scalar.js`, `math/cell-edge.js`, `math/periodic.js` |
| Geometry | `geometry/builder.js` and `geometry/primitives.js` merge primitives into typed buffers or a Three.js mesh. `geometry/sculpt.js` builds lofted, skinned shapes. `geometry/instances.js` and `rendering/piece-batch.js` draw repeated or changing pieces. | `geometry/sampled-surface.js`, `geometry/placement.js`, `geometry/creased-sheet.js`, `geometry/sagging-tube.js`, `rendering/cell-lod.js` |
| Terrain | `geometry/terrain-chunks.js` refines a height grid in mesh batches. `geometry/heightfield.js` samples and refines it, `math/mountain-ranges.js` raises relief and `geometry/strata-field.js` plans rock outcrops. | `geometry/terrain-extension.js`, `geometry/erosion.js`, `geometry/strata-tiles.js`, `geometry/scatter-grid.js`, `geometry/outline-grid.js`, `geometry/path-field.js`, `math/rock-texture.js`, `rendering/terrain-rock.js`, `rendering/strata-material.js`, `rendering/talus.js`, `rendering/road-surface.js` |
| Water | `rendering/water-material.js` shades lakes, streams and rivers. `geometry/stream.js` builds stream ribbons and `geometry/shore-grid.js` measures distance to shorelines. | `rendering/sea-shaders.js`, `rendering/wakes.js`, `rendering/stream-flow.js`, `rendering/rain-rings.js`, `rendering/planar-reflection.js` |
| Sky and weather | `rendering/sky.js` combines `rendering/cloud-field.js` and `rendering/cloud-dome.js` into a volumetric cloud sky ([fixture](test/atmosphere.js)). `motion/weather.js` and `motion/wind.js` drive rain, dust, squalls and gusts. | `math/cloud-textures.js`, `rendering/daylight.js`, `rendering/height-haze.js`, `rendering/particles.js`, `math/particle-noise.js`, `rendering/particle-emitters.js`, `rendering/flocks.js` |
| Characters | `geometry/head-shape.js` builds parametric heads, `geometry/hair-shell.js` hair and `rendering/garment-material.js` cloth, plate and mail ([fixture](test/garment-material.js)). `motion/biped-stride.js` and `motion/quadruped.js` animate gaits, and `rendering/crowd-skinning.js` draws instanced skinned crowds. | `geometry/ear.js`, `geometry/face-grid.js`, `geometry/head-profile.js`, `geometry/hair-locks.js`, `geometry/hair-gathers.js`, `geometry/hair-patch.js`, `geometry/hair-tags.js`, `geometry/garment-tags.js`, `math/cloth-textures.js`, `rendering/hair-strands.js`, `motion/arm-reach.js`, `motion/crowd-alarms.js`, `motion/crowd-routine.js` |
| Labels | `createLabelRange(near, far)` fades labels by world distance. Use a selection per group to keep the nearest visible member as its label anchor. | `rendering/label-range.js`, [example and checks](test/label-range.test.js) |
| Surfaces | `rendering/surface-projection.js` projects textures in metres onto standard materials and `rendering/surface-light.js` adds wetness and backlighting ([fixture](test/projected-surface.js)). `math/surface-textures.js` fills seeded, tileable masonry, plaster, roof tile, rock, plank, foliage, ground, road, brick and ice textures, in a worker if wanted. | `rendering/interior-mapping.js`, `rendering/crust.js`, `rendering/low-light.js`, `rendering/material-lod.js`, `rendering/textures.js`, `rendering/texture-fills.js` |
| Lights and shadows | `rendering/far-shadow.js` pairs near and far directional shadows, `rendering/static-point-shadow.js` caches point-light shadows and `rendering/sky-occlusion.js` darkens covered areas. | `rendering/shadow-depth.js`, `rendering/shadow-alignment.js`, `rendering/local-lights.js`, `rendering/caster-motion.js`, `rendering/still-casters.js`, `rendering/contact-shadows.js`, `rendering/light-points.js`, `rendering/light-shafts.js`, `rendering/glow-lines.js`, `rendering/glow-shell.js`, `rendering/light-budget.js`, `rendering/stage-lights.js` |
| Rendering pipeline | `rendering/context.js` sets up WebGL2, a scene and a camera. `rendering/post.js` and `rendering/taa.js` compose HDR passes and temporal antialiasing, and `rendering/shader-warmup.js` compiles programs ahead of use. | `rendering/dof.js`, `rendering/post-shaders.js`, `rendering/eye-adapt.js`, `rendering/viewport.js`, `rendering/world-matrices.js`, `rendering/compilation-schedule.js`, `rendering/height-probe.js` |
| Player and world | `motion/spaces.js` and `motion/player.js` move a first-person controller over terrain, decks and colliders. | `motion/instance-sight.js`, `motion/daily-clock.js`, `runtime/spatial-audio.js` |
| Runtime | `runtime/pool.js` and `runtime/worker.js` run named jobs on module workers. `runtime/quality-fit.js` adapts quality to measured GPU time. | `runtime/device-quality.js`, `runtime/quality-store.js`, `runtime/gpu-timing.js`, `runtime/first-use.js`, `runtime/hand-over.js`, `runtime/seen.js`, `runtime/frame-yield.js`, `runtime/grid-cache.js`, `runtime/grid-rows.js`, `runtime/events.js`, `runtime/diagnostic-log.js`, `runtime/module-preload.js`, `runtime/search.js` |

Use `circleClearances(centres, gapFraction = 0)` from `roamwright/math/circle-clearances.js` when laying out circular footprints around fixed x-z positions. It returns one radius limit per input. A value of 0.1 reserves a tenth of the distance between neighbouring centres as a gap. Cap each result by the space available or the desired radius.

## Contributing and license

See the [contributor guide](CONTRIBUTING.md) for local checks and release instructions. Use [GitHub Issues](https://github.com/enestaylan/roamwright/issues) for bugs and feature requests, or [report a vulnerability privately](https://github.com/enestaylan/roamwright/security/advisories/new).

Roamwright is distributed under the [MIT license](LICENSE). Notices for adapted components are in [licenses](licenses).

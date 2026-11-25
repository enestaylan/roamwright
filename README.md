# Roamwright

[![npm version](https://img.shields.io/npm/v/roamwright)](https://www.npmjs.com/package/roamwright)
[![Compatibility tests](https://github.com/enestaylan/roamwright/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/enestaylan/roamwright/actions/workflows/test.yml)

Roamwright is a Three.js library for building procedural worlds you can explore on foot or in flight. Generate terrain from a seed, batch scenery into meshes, and use the same terrain to guide movement through the world in your browser. For larger worlds, a worker pool can build geometry off the main thread.

![A red passenger train on a stone viaduct above a winding alpine river, with conifers on the banks and snow on the peaks](https://raw.githubusercontent.com/enestaylan/roamwright/main/docs/alpine-viaduct.jpg)

**Alpine viaduct, seed 42.** One height field shapes the riverbed and snowy ridges and determines where the conifers take root. Eight copies of an arch profile form the viaduct. The stonework, rails and overhead wires share one mesh. The four-car electric train moves as a separate mesh. Choose Valley, Trackside or Riverbank and select **Run train** to watch it cross. [Explore the example source](examples/viaduct.js).

## Install

```sh
npm install roamwright
```

npm resolves the Three.js peer in a new project. If you already use Three.js, the supported versions are **0.170.0** and **0.187.0**. To select one explicitly, run `npm install roamwright three@0.187.0`. The renderer requires WebGL 2.

## Built with Roamwright

[Malazan](https://enestaylan.com/malazan/) is an explorable world built with Roamwright. Fly over Darujhistan, Pale, and the Rhivi Plain from *Malazan Book of the Fallen*.

## Examples

| Live example | What the example shows | Source |
| --- | --- | --- |
| [Alpine viaduct](https://enestaylan.github.io/roamwright/examples/viaduct.html?seed=42) | Watch an electric train cross eight stone arches from the valley, trackside or riverbank. Change the seed to generate another landscape. | [viaduct.js](examples/viaduct.js) |
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

| Import from `roamwright/` | Use |
| --- | --- |
| `math/noise.js`, `math/random.js`, `math/curve.js` | Create independent seeded noise fields, resumable random streams and evenly spaced spline samples. These modules also run in workers. |
| `geometry/builder.js`, `geometry/primitives.js` | Transform and merge primitives, produce typed vertex buffers, or build a Three.js mesh. Colors passed to the builder are linear RGB. |
| `geometry/terrain-extension.js` | Extend an XZ grid to the horizon with concentric rings. `terrainExtension({ size, segments, reach, centerX, centerZ, growth })` returns transferable positions, triangle indices and the source grid index of each vertex on the inner boundary. Sample your height and shading at those positions. |
| `math/mountain-ranges.js` | `createMountainRanges(seed)` owns one field. Call `layout(uplands)`, then `heightAt(x,z)` for relief in metres and read `surface.scree` for the last sample. Supply ellipses (`x,z,rx,rz,h,rough`), optional hill counts (`hills`), or crest lines (`crest: [[x,z,heightFraction],…], wide,h,rough`). `wide` is a half-width in metres. `crestOf(spec)` gives the line and width for a map. |
| `math/rock-texture.js`, `math/cell-edge.js` | `createRockTexture(seed)` returns a tileable pixel fill `(u,v,rgb)` with grain, fractures and weathering in the three byte channels. Pass `{ fractures: 'joints' }` as its second argument for interrupted, directional joint sets and bedding seams. `cellEdge(hash,x,y,cells,salt,site?)` measures distance to a jittered cell edge in unit-tile coordinates. |
| `rendering/terrain-rock.js` | Include `terrainRockGLSL` in a fragment shader to sample bedrock from a world position, surface normal, repeat-wrapped grain texture and four linear bed colours. `terrainRock` returns RGB colour and alpha relief. `terrainReliefGLSL` provides `terrainReliefNormal(viewToEye,normal,height,strength,fadeMetres)` for nearby resolved relief. |
| `rendering/strata-material.js` | `createStrataMaterial({texture,palette,snowline,shading,vertex,uniforms})` returns `material` and `depth`. Provide a linear RGB palette with dark, light, iron, shale, dust, lichen, crust and snow triples. Geometry needs vertex colors, a vec4 `aRock` (tint, hardness, cavity, exposure) and a float `aYY` (bed height, metres). Both passes optionally run your `cliffMorph()` vertex code setting `cP,cN,cHide` in terrain coordinates. A fragment hook `float rockShade(vec2 xz)` supplies environmental shade. Dispose both materials when done. |
| `geometry/heightfield.js` | Sample a regular X/Z Three.js plane at its rendered triangle height with `heightfieldSampler(geometry, outside)`. Use `refineHeightfield(base, { x, z, cells, subdivisions, height, createPatch })` to replace a square of cells during construction. The callback receives the snapped center, width, depth, segment count and edge-matched height function. Return the new plane geometry in the base's coordinate system. The returned sampler covers both resolutions and uses `height` outside the base. |
| `geometry/instances.js`, `rendering/piece-batch.js` | Draw repeated geometry with instancing or collect changing pieces into a GPU batch. |
| `math/color.js` | Convert 8-bit sRGB channels with the `SRGB2LIN` lookup, scale linear RGB triples with `dim`, or apply the Three.js ACES fit to a color with `acesToColor(color, exposure)`. |
| `runtime/grid-cache.js`, `runtime/events.js` | Store typed grids by application-supplied database and build key, or create isolated synchronous event channels. |
| `rendering/height-probe.js` | Query the highest opaque surface within a square via an asynchronous GPU readback. Supply the scene, renderer, probe dimensions and an optional wait for pending compilation. |
| `runtime/grid-rows.js` | Split typed grids with `cutRows(grids, rows, start, end)` and reassemble independently completed bands with `pasteRows(grids, rows, start, bands)`. Each grid may have a different number of values per row. |
| `motion/quadruped.js` | Supply joint positions, feet and gait profiles to `makeRig`. Call `stepRig` with a world transform and optional ground sampler. Set the optional initial phase to reproduce a gait. |
| `geometry/sampled-surface.js`, `geometry/erosion.js` | Sample a parametric sheet into a geometry builder or erode a masked square heightfield using an injected random source and droplet parameters. |
- `geometry/sculpt.js` exports `createSculptor({ vertexTag })` for indexed or flat lofts, blended bone weights, surface relief and cached parametric shapes. A sculptor owns its scratch buffers, detail level and mesh cache. `loft(builder, x, y, z, rings, sides, options)` writes to a geometry builder. Each ring supplies height, X/Z radii, X/Z center, RGB, two bone indices and the first bone’s weight. The optional `vertexTag(builder, ring, angle, options, previousTag)` supplies a material tag. `sculptMesh(key, detail, shape, warp)` samples a direction-to-position callback and two scalar channels. `setLodLo(0 | 1 | 2)` selects detail. The module also exports `triangle` to wind three weighted vertices to match their normals.
| `motion/instance-sight.js` | Register upright instanced obstacles with `createInstanceSight().add(space, mesh, crownFraction, trunkRadius)` and query `obstructed(space, eye, target, angularMargin)`. |
| `rendering/texture-fills.js` | Schedule RGBA texture fills with application-provided definitions, worker requests and a synchronous fallback. |
| `rendering/glow-lines.js`, `rendering/glow-shell.js` | Draw constant-pixel outlines or softly lit shells from 3D line segments and a base-height callback. |
| `rendering/contact-shadows.js` | Add a `ContactShadows({ capacity, opacity, lift })` mesh to a scene. Each frame call `begin()`, `add(x, receiverY, z, radius, intensity)` for each contact, then `end()`. All contacts share one draw. Call `dispose()` when finished. |
| `motion/spaces.js`, `motion/player.js` | Give a space terrain height, decks and colliders. Set the controller's input axes, call `update(deltaSeconds)`, then `applyCamera(camera)`. Distances are in metres. |
| `runtime/pool.js`, `runtime/worker.js` | Register named jobs on a module worker and send work from the page. Typed-array buffers in results transfer back to the caller. |
| `rendering/shadow-depth.js`, `rendering/static-point-shadow.js` | Install per-renderer caster hooks with `installShadowDepth(renderer)`. `createStaticPointShadow(renderer).keep(pointLight)` caches the marked static layer of one point light and draws moving casters over it. Call `stale()` to check whether the next pass needs to rebuild it. Multiple shadowed point lights use normal full draws. Dispose the cache, then call `hooks.dispose(scene)` to release the shared materials and detach the hooks. |
| `rendering/far-shadow.js`, `rendering/local-lights.js` | Before compiling, opt into `installLocalLightCulling()` and/or `installFarShadowShader({nearDepth,farDepth})`. The latter pairs the first two shadowed directional lights into near/far maps. `createFarShadow({scene,camera,direction,ground,config,mapSize,active})` creates the second light. Its config supplies the half-range, fractional lead, movement step, cosine turn threshold, refresh seconds (every), lift, back, above-ground allowance and bias/normalBias in world units. Call `update(dtSeconds)` after moving the camera, `setSize(texels)` to resize, and `dispose()` on teardown. |
| `rendering/sky-occlusion.js` | Obtain shared uniforms and a standard-material shader patch from `createSkyOcclusionShader({minimum,underCover})`. Pass those uniforms to `createSkyOcclusion({renderer,scene,camera,uniforms,config,samples,ground,strength,occludes,warmup})`. Config specifies the square half-width, texture size, movement step, refresh interval (every), height above ground and depth range. Sample distances are in world units. The strength callback receives camera height above ground. Use `warm(root)`, `update(dtSeconds)` and `dispose()`. |
| `rendering/shader-warmup.js` | `createShaderWarmup({renderer,scene,camera,postMaterials})` compiles a group at once (`compiled`) or incrementally (`compiledInTurn`). Warm selected overrides using `warmStandIns(root, materialFor, camera, target, fog)`, depth and point passes with `warmShadowPass(root)`, and screen passes with `warmPostPasses()`. The optional callback returns material/target pairs (null for screen). `compilingNow()` reports pending work. Call `dispose()` when finished. |
| `rendering/compilation-schedule.js` | `createCompilationSchedule({renderer,scene,beginCompiles,putToUse,useProgram,timeoutMs,onError})` schedules early (`beginWarm()`), initial and incremental (`warmShaders(root)`) compilation. Supply the pass graph as `beginCompiles(root, fullyWarmed)` and the desired first-use behavior. |
| `rendering/viewport.js` | Calculate a buffer's pixel ratio with `fittedPixelRatio(width,height,ratio,maxPixels)` and its perspective sprite scale with `perspectivePointScale(bufferHeight,verticalFovDegrees)`. |
| `rendering/context.js`, `rendering/world-matrices.js` | Set up WebGL2, a camera, a scene and world group. Optionally track static transforms once per frame before drawing. |
| `rendering/post.js`, `rendering/taa.js`, `rendering/dof.js` | Compose HDR passes, temporal antialiasing, depth of field, exposure and upscaling. The application supplies its camera, effect scene and sky occlusion mask. |
| `runtime/gpu-timing.js`, `runtime/quality-fit.js`, `runtime/quality-store.js` | Measure GPU work, adapt quality and persist a visitor's settings in a storage namespace chosen by the application. |

For geometry generated off the main thread, call `builder.parts(true)` in the worker and `geometryOf(parts)` on the page. This path frees static CPU-side attributes after upload. Keep the seed or source data if your application needs to regenerate meshes after a context loss.

## Heads and garment surfaces

`headFn(features, fine)` in `geometry/head-shape.js` creates a parametric head in metres. Pass proportions such as `jaw`, `cheek`, `brow`, `nose`, `eyeGap` and `lips`; unspecified features use neutral proportions. Its `point(heightMillimetres, angleRadians, vector, channels)` samples a face measured from eye level. The optional output array contains lip, shade, warmth, beard, eyebrow, moustache, tuft and scar masks. Use `faceGrid(rows, across, behind, backRows)` in `geometry/face-grid.js` to choose rows by height, frontal columns by lateral millimetres, rear columns by degrees, and the subset of rows continued around the back. `faceSculpt(head, grid)` returns positions `P`, seam-matched normals `N`, mask channels `CH` and triangle indices `idx`. `faceAt(head, x, y, lift)` returns a surface point and normal in metres. Individual heads, their palettes and their level-of-detail choices belong to the application.

`createClothTextures({seed, foldSeed, threads})` in `math/cloth-textures.js` returns factories for repeatable weave, hanging folds and creases. Call `weave()`, `folds()` or `crumple()` once, then call its texel function with normalized `u, v` and a reusable RGB array (channel values 0–255). In `geometry/garment-tags.js`, `garmentTag(crease, KIND.linen)` encodes a fabric kind and the local amount of gathering. Positive tags distinguish skin (1) and wet eyes (2). `garmentShader({scale, threads, textureSize})` in `rendering/garment-material.js` returns declarations and color, normal, roughness and metalness stages for a Three.js standard material. Supply the original object position `vL`, interpolated tag `vSk`, sampled weave `tx`, height `gH`, and textures `uFolds` and `uCrumple`. The [render fixture](test/garment-material.js) shows how to insert the stages.

## Atmospheric rendering

Use `motion/wind.js` to create an independent wind field with `createWind()`. Its `update(elapsedSeconds, gust)` advances velocity and accumulated drift for all materials sharing its uniforms. `motion/weather.js` provides a weather clock. Call the function returned by `createWeather()` with the weather state, frame delta in seconds, fractional hour, and a reusable conditions object. Its `region` identifies the current area. Its `weather` can specify a `spell` (`rain`, `dust` or `squall`), ranges of seconds `every` and `lasts`, an optional circular footprint `{ x, z, reach }`, and `mist` at dawn. Conditions also include viewer `x` and `z`, clock `running`, `quiet` to suppress spells and `ambientDust`. Initialize the numeric state fields `wet`, `rain`, `damp`, `gust`, `dustStorm`, `dust` and `mist` to zero, and `storm` to −1 for automatic weather.

The sky combines three modules. Create a field with `createCloudField(options)` from `rendering/cloud-field.js`, then a dome with `createCloudDome({ renderer, field })` from `rendering/cloud-dome.js`. Assign a repeating RGBA data texture to `field.uniforms.uCloudField.value` and a repeating RGBA 3D texture to `field.billows.value`. The pure `createCloudTextures({ seed })` factory in `math/cloud-textures.js` supplies periodic texel fills for both, suitable for module workers. Tell the field its 2D texture width with `textureSize` (default 512). Share its shadow uniforms and `shadowGLSL` with receiving materials. Optionally pass a `warmProgram(material)` callback to the dome to compile ahead of the first draw. Await `setDetail` to wait for that compilation. Set the dome's detail using `setDetail({ size, frames, steps, most, light, first, grow, fine })`: map resolution, bands per full map, regular and maximum ray steps, light steps, initial light step, its growth factor and fine detail (0 or 1).

Create the visible mesh with `createSky({ field, dome })` from `rendering/sky.js`. Add `sky.mesh` to your scene; `sky.mask` draws the corresponding depth-and-cloud occlusion for a post-processing pass. Supply the sky material’s sun and moon directions, light and horizon colors, and day, night and weather values. Each frame call `field.place(x, z, windDrift, lightDirection, cloudThreshold, shadowStrength)`, then `dome.update(deltaSeconds, lightDirection, cloudThreshold, elapsedSeconds, lightIntensity, region)`. Dispose the sky and caller-owned textures and await `dome.dispose()` before disposing the renderer. The [browser fixture](test/atmosphere.js) renders a complete example.

`rendering/daylight.js` provides `createSunMoonCycle()`, which writes orbital directions into two reusable vectors, and `createHazeFollower()`, which follows terrain height between camera cuts. `installHeightHaze()` from `rendering/height-haze.js` explicitly installs height-dependent fog for one Three.js runtime. Call it before compiling fog materials, set its haze and low mist parameters, then call `dispose()` when retiring those materials to restore the original fog shader chunks.

## Contributing and license

See the [contributor guide](CONTRIBUTING.md) for local checks and release instructions. Use [GitHub Issues](https://github.com/enestaylan/roamwright/issues) for bugs and feature requests, or [report a vulnerability privately](https://github.com/enestaylan/roamwright/security/advisories/new).

Roamwright is distributed under the [MIT license](LICENSE). Notices for adapted components are in [licenses](licenses).

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
| `geometry/strata-field.js`, `geometry/strata-tiles.js` | `createStrataField({seed,cells,spacing,levels,slopeRange,bedRange})` plans outcrops on a centred square heightfield. Pass metre heights, RGB byte colours, XYZ normals and an `exposure(index,x,z)` slope callback to `planCliffShape`. Transfer the copied plan with `cliffShapePlan` and `takeCliffShape(plan,{heights,colours})`. `createStrataTiles({size,...field})` groups the exposed area into three levels of geomorphable tiles. Call `planRegion`, then `boxNow(level,boxKey(tile,level))` or iterate `boxArrays(level,tiles)` to schedule its work. |
| `rendering/talus.js` | `talusGLSL` supplies `talusFragment(metres, dx, dy, spacing, seed)` for shaded angular fragments on scree aprons. Pass the screen derivatives of the world position before branching on apron coverage. The function returns relative facet brightness and relief, attenuated by the pixel footprint. |
| `rendering/road-surface.js` | `createRoadMaterial({ grit, dampness })` shades packed dirt on a road strip using a repeating RGB grit texture and a shared wetness uniform from 0 to 1. Geometry supplies vertex colour, RGB `verge` and a vec4 `road` (cross-strip metres, metres along, half-width metres, grass on the crown). |
| `rendering/terrain-rock.js` | Include `terrainRockGLSL` in a fragment shader to sample bedrock from a world position, surface normal, repeat-wrapped grain texture and four linear bed colours. `terrainRock` returns RGB colour and alpha relief. `terrainReliefGLSL` provides `terrainReliefNormal(viewToEye,normal,height,strength,fadeMetres)` for nearby resolved relief. |
| `rendering/strata-material.js` | `createStrataMaterial({texture,palette,snowline,shading,vertex,uniforms})` returns `material` and `depth`. Provide a linear RGB palette with dark, light, iron, shale, dust, lichen, crust and snow triples. Geometry needs vertex colors, a vec4 `aRock` (tint, hardness, cavity, exposure) and a float `aYY` (bed height, metres). Both passes optionally run your `cliffMorph()` vertex code setting `cP,cN,cHide` in terrain coordinates. A fragment hook `float rockShade(vec2 xz)` supplies environmental shade. Dispose both materials when done. |
| `geometry/scatter-grid.js` | `createScatterGrid({ rings, hash, seeds, fill, start, finish })` returns `update(x, z, density)` for deterministic moving ground cover. Supply grids from fine to coarse as `{ cell, half, refill }` (cell width and refill distance in metres, half width in cells). Density ranges from 0 to 1. Each refill optionally calls `start(level)` and samples `fill(level, index, x, z, h1, h2, column, row, cell)`; return true to keep a sample. After changed grids are filled, `finish(grids)` receives per-level counts and fade radii in metres. |
| `geometry/outline-grid.js`, `geometry/path-field.js` | Bake a transferable rectangular signed-distance field with `polyGrid(outline, cell, pad)` and sample it with `gridField(grid)(x,z)` (negative inside). `polyField` combines both. `nearestPathPoint({line,box:pathBox(line)}, x,z,reach,result)` updates distance `d`, normalized segment coordinate `t` and side (±1) on a hit strictly within reach. `stampPath({x0,z0,width,height,spacing}, points,radius,distances,values?,valueAt?)` stores the distance to the closest sample and its optional value in a rectangular grid, visiting the square around each sample. |
| `geometry/heightfield.js` | Sample a regular X/Z Three.js plane at its rendered triangle height with `heightfieldSampler(geometry, outside)`. Use `refineHeightfield(base, { x, z, cells, subdivisions, height, createPatch })` to replace a square of cells during construction. The callback receives the snapped center, width, depth, segment count and edge-matched height function. Return the new plane geometry in the base's coordinate system. The returned sampler covers both resolutions and uses `height` outside the base. |
| `geometry/instances.js`, `rendering/piece-batch.js` | Draw repeated geometry with instancing or collect changing pieces into a GPU batch. |
| `math/color.js` | Convert 8-bit sRGB channels with the `SRGB2LIN` lookup, scale linear RGB triples with `dim`, or apply the Three.js ACES fit to a color with `acesToColor(color, exposure)`. |
| `runtime/diagnostic-log.js` | Create a bounded page log with deferred persistence under an application storage key. Repeated entries share a count, and `save()` flushes on page exit. |
| `runtime/search.js` | Split text into normalized words with `searchWords`, then rank matches with `fuzzyScore(queryWords, titleWords, descriptionWords)`. |
| `runtime/module-preload.js` | `createModulePreloader(baseURL)` returns a function that adds module preload links once for a list of relative URLs. |
| `runtime/frame-yield.js` | Await `nextFrame(maxWaitMs)` to yield until a frame or timeout. `painted(maxWaitMs)` also yields a task after the frame for UI updates. The default timeout is 50 ms. |
| `runtime/grid-cache.js`, `runtime/events.js` | Store typed grids by application-supplied database and build key, or create isolated synchronous event channels. |
| `rendering/height-probe.js` | Query the highest opaque surface within a square via an asynchronous GPU readback. Supply the scene, renderer, probe dimensions and an optional wait for pending compilation. |
| `runtime/grid-rows.js` | Split typed grids with `cutRows(grids, rows, start, end)` and reassemble independently completed bands with `pasteRows(grids, rows, start, bands)`. Each grid may have a different number of values per row. |
| `motion/quadruped.js` | Supply joint positions, feet and gait profiles to `makeRig`. Call `stepRig` with a world transform and optional ground sampler. Set the optional initial phase to reproduce a gait. |
| `geometry/sampled-surface.js`, `geometry/erosion.js` | Sample a parametric sheet into a geometry builder or erode a masked square heightfield using an injected random source and droplet parameters. |
| `geometry/sculpt.js` | `createSculptor({ vertexTag })` creates a sculptor for indexed or flat lofts, blended bone weights, surface relief and cached parametric shapes. A sculptor owns its scratch buffers, detail level and mesh cache. `loft(builder, x, y, z, rings, sides, options)` writes to a geometry builder. Each ring supplies height, X/Z radii, X/Z center, RGB, two bone indices and the first bone’s weight. The optional `vertexTag(builder, ring, angle, options, previousTag)` supplies a material tag. `sculptMesh(key, detail, shape, warp)` samples a direction-to-position callback and two scalar channels. `setLodLo(0 \| 1 \| 2)` selects detail. The module also exports `triangle` to wind three weighted vertices to match their normals. |
| `motion/instance-sight.js` | Register upright instanced obstacles with `createInstanceSight().add(space, mesh, crownFraction, trunkRadius)` and query `obstructed(space, eye, target, angularMargin)`. |
| `rendering/texture-fills.js` | Schedule RGBA texture fills with application-provided definitions, worker requests and a synchronous fallback. |
| `rendering/glow-lines.js`, `rendering/glow-shell.js` | Draw constant-pixel outlines or softly lit shells from 3D line segments and a base-height callback. |
| `rendering/light-points.js` | `createLightPoints({ positions, color, intensity, pointScale, emitterDiameter, haloDiameter })` makes one depth-tested additive point batch. Supply XYZ triples in a Float32Array, a linear Three.js Color, and shared uniforms for intensity (0–1) and pixels per world unit at unit depth. Set `emitterDiameter: 0` to draw only the smooth halo when the physical core is unresolved. Diameters and optional distance fades (`fadeIn`, `fadeOut` pairs) are in world units. Optional `minPixels` keeps unresolved sources visible, `daytime` sets their gain at zero intensity and `distantGain` sets their gain from 900 units. Supply per-point `seeds`, `time` in seconds and fractional `variation` for animated emitters. Dispose the returned geometry and material when finished. |
| `rendering/contact-shadows.js` | Add a `ContactShadows({ capacity, opacity, lift })` mesh to a scene. Each frame call `begin()`, `add(x, receiverY, z, radius, intensity)` for each contact, then `end()`. All contacts share one draw. Call `dispose()` when finished. |
| `rendering/low-light.js` | Include `LOW_LIGHT_REFLECTANCE` in a fragment shader. `lowLightReflectance(albedo, adaptation)` blends linear RGB towards equal-luminance gray as adaptation goes from 0 to 1. `diffuseTextileBounce(albedo, irradiance, fiberScatter)` models a neutral component of diffuse fiber scatter, with its share set between 0 and 1. |
| `motion/spaces.js`, `motion/player.js` | Give a space terrain height, decks and colliders. Set the controller's input axes, call `update(deltaSeconds)`, then `applyCamera(camera)`. Distances are in metres. |
| `runtime/pool.js`, `runtime/worker.js` | Register named jobs on a module worker and send work from the page. Typed-array buffers in results transfer back to the caller. |
| `rendering/shadow-depth.js`, `rendering/static-point-shadow.js` | Install per-renderer caster hooks with `installShadowDepth(renderer)`. `createStaticPointShadow(renderer).keep(pointLight)` caches the marked static layer of one point light and draws moving casters over it. Call `stale()` to check whether the next pass needs to rebuild it. Multiple shadowed point lights use normal full draws. Dispose the cache, then call `hooks.dispose(scene)` to release the shared materials and detach the hooks. |
| `rendering/far-shadow.js`, `rendering/local-lights.js` | Before compiling, opt into `installLocalLightCulling()` and/or `installFarShadowShader({nearDepth,farDepth})`. The latter pairs the first two shadowed directional lights into near/far maps. `createFarShadow({scene,camera,direction,ground,config,mapSize,active})` creates the second light. Its config supplies the half-range, fractional lead, movement step, cosine turn threshold, refresh seconds (every), lift, back, above-ground allowance and bias/normalBias in world units. Call `update(dtSeconds)` after moving the camera, `setSize(texels)` to resize, and `dispose()` on teardown. |
| `rendering/sky-occlusion.js` | Obtain shared uniforms and a standard-material shader patch from `createSkyOcclusionShader({minimum,underCover})`. Pass those uniforms to `createSkyOcclusion({renderer,scene,camera,uniforms,config,samples,ground,strength,occludes,warmup})`. Config specifies the square half-width, texture size, movement step, refresh interval (every), height above ground and depth range. Sample distances are in world units. The strength callback receives camera height above ground. Use `warm(root)`, `update(dtSeconds)` and `dispose()`. |
| `rendering/shader-warmup.js` | `createShaderWarmup({renderer,scene,camera,postMaterials})` compiles a group at once (`compiled`) or incrementally (`compiledInTurn`). Warm selected overrides using `warmStandIns(root, materialFor, camera, target, fog)`, depth and point passes with `warmShadowPass(root)`, and screen passes with `warmPostPasses()`. The optional callback returns material/target pairs (null for screen). `compilingNow()` reports pending work. Call `dispose()` when finished. |
| `rendering/compilation-schedule.js` | `createCompilationSchedule({renderer,scene,beginCompiles,putToUse,useProgram,timeoutMs,onError})` schedules early (`beginWarm()`), initial and incremental (`warmShaders(root)`) compilation. Supply the pass graph as `beginCompiles(root, fullyWarmed)` and the desired first-use behavior. |
| `rendering/viewport.js` | Calculate a buffer's pixel ratio with `fittedPixelRatio(width,height,ratio,maxPixels)` and its perspective sprite scale with `perspectivePointScale(bufferHeight,verticalFovDegrees)`. |
| `rendering/context.js`, `rendering/world-matrices.js` | Set up WebGL2, a camera, a scene and world group. Optionally track static transforms once per frame before drawing. |
| `rendering/post.js`, `rendering/taa.js`, `rendering/dof.js` | Compose HDR passes, temporal antialiasing, depth of field, exposure and upscaling. The application supplies its camera, effect scene and sky occlusion mask. Pass `contactRadius` in metres and a `contactStrength()` callback to add short-range depth samples to the ambient occlusion pass. The default strength of zero retains the original pass output. |
| `runtime/gpu-timing.js`, `runtime/quality-fit.js`, `runtime/quality-store.js` | Measure GPU work, adapt quality and persist a visitor's settings in a storage namespace chosen by the application. |
| `motion/daily-clock.js` | Supply callbacks for the frame and hour to `createDailyClock()`. Check for time jumps and evaluate activity ramps and ranked time spans across midnight. |
| `runtime/device-quality.js` | `createDeviceQuality()` chooses an initial quality level from graphics renderer, available memory, cores and pointing-device information. The hardware query is cached. |
| `rendering/particles.js`, `math/particle-noise.js` | Create additive and alpha instanced particle pools using a shared noise texture. Supply an effect scene, a perspective point-scale uniform, elapsed seconds and a lazy noise texture factory. For soft intersections, pass the post pipeline’s scene-depth uniforms. Fill the returned `spawn` record, call `pSpawn(pool)` and flush each pool before drawing. |
| `runtime/spatial-audio.js` | Synthesize loopable pink or brown noise, position a Web Audio panner, and set the listener pose from a Three.js camera matrix. |
| `rendering/material-lod.js` | Create screen-door fades using an opacity uniform, camera distance or an instance’s `aNear` attribute. Near and far variants share complementary coverage. Use `handOverShadow()` to skip instances hidden by their LOD and `twinMaterial(base, kind)` to cache clones for different mesh classes. |
| `rendering/shadow-alignment.js` | Snap a shadow camera’s world-space target to texel boundaries or fit a square orthographic shadow frustum. `createShadowSnap()` retains its scratch vectors and supports unequal texel dimensions. |
| `rendering/light-shafts.js` | Create emissive wayfinding pillars, with fixed height under a roof or a height based on surrounding terrain and an asynchronous height probe outdoors. Supply shared time and night uniforms; `footRadius` and `topRadius` set the taper. |
| `rendering/caster-motion.js` | Create a cached signature of nearby skinned and instanced caster motion for a point-shadow refresh policy. Supply the scene and elapsed seconds. The signature is `-1` where a skinned caster may animate. |
| `rendering/crowd-skinning.js` | Build instanced texture-skinned meshes with shared color and depth transforms. `applyCrowdSkinning(shader, {poseUniform, walk, depth, paletteOffset})` reads animation and palette row numbers from `aCrowdRows` and uses `aJoints` and `aWeight` for weighted joints. Optional baked motion stores positions and packed normals in an RGBA texture. Use `bakeCrowdFrame({geo, vertices, k}, bones)` to append a frame and update its cursor. |
| `geometry/head-shape.js`, `geometry/face-grid.js`, `geometry/ear.js` | `headFn(features, fine)` creates a parametric head in metres from proportions such as `jaw`, `cheek`, `brow`, `nose`, `eyeGap` and `lips`. Its `point(heightMillimetres, angleRadians, vector, channels)` samples the face from eye level, with optional lip, shade, warmth, beard, eyebrow, moustache, tuft and scar masks. `faceGrid(rows, across, behind, backRows)` chooses sample rows and columns, `faceSculpt(head, grid)` returns positions `P`, seam-matched normals `N`, mask channels `CH` and indices `idx`, and `faceAt(head, x, y, lift)` returns a surface point and normal. `buildEar(builder, head, side, height, skin, bone)` adds an ear on side −1 or 1 that closes into the skull. |
| `math/cloth-textures.js`, `geometry/garment-tags.js`, `rendering/garment-material.js` | `createClothTextures({seed, foldSeed, threads})` returns `weave()`, `folds()` and `crumple()` factories whose texel functions fill a reusable RGB byte array at normalized `u, v`. `garmentTag(crease, KIND.linen)` encodes a fabric kind and local gathering; positive tags mark skin (1) and wet eyes (2), `KIND.plate` polishes rims tagged 1 and `KIND.mail` draws filtered links. `garmentShader({scale, threads, textureSize})` returns standard-material stages that read `vL`, `vSk`, `tx`, `gH`, `uFolds` and `uCrumple`. See the [render fixture](test/garment-material.js). |
| `geometry/hair-shell.js`, `geometry/hair-locks.js`, `geometry/hair-gathers.js`, `geometry/hair-patch.js`, `rendering/hair-strands.js` | Shape a hair mass with `massOf({skull, scale, inHair})`, sample it with `createHairShells(sculptMesh)` using a distinct key per shape and detail, and fit it with `placeHairShell()` plus placement and colour callbacks. Trace ribbons on the shell with the lock functions and build sheets, braids and knots with `hang`, `plait` and `knot`. `packHairPatch(points, triangles, emitVertex)` numbers vertices once per strand band. The GLSL stages add direction-dependent sheen and strand detail that fades with pixel width. See the [geometry test](test/hair-geometry.test.js). |
| `motion/biped-stride.js` | `createBipedStride({rig, foot, pace, ground})` returns a stride solver for leg dimensions in rig units, foot and pace profiles and ground height in metres. Call `stride(actor, dt, scale, lean, sink, hipZ, stanceL, stanceR, grounded, list, strideScale = 1, liftScale = 1, hipScale = 1)` for each actor, keep its feet, ground, phase and hip height between calls, and read the joint angles, root displacement and arm swing before advancing the next actor. See the [walking fixture](test/biped-stride.test.js). |
| `motion/wind.js`, `motion/weather.js` | `createWind()` returns shared uniforms and `update(elapsedSeconds, gust)` for velocity and accumulated drift. `createWeather()` returns a clock to call with the weather state, delta seconds, fractional hour and a reusable conditions object. A region's `weather` can schedule `rain`, `dust` or `squall` spells with `every` and `lasts` ranges, an optional `{ x, z, reach }` footprint and dawn `mist`. Initialize the numeric state fields to zero and `storm` to −1 for automatic weather. |
| `rendering/cloud-field.js`, `rendering/cloud-dome.js`, `rendering/sky.js`, `math/cloud-textures.js` | Build the sky from `createCloudField(options)`, `createCloudDome({ renderer, field })` and `createSky({ field, dome })`; `sky.mask` draws depth-and-cloud occlusion for post-processing. Fill the field's repeating 2D and 3D textures with the worker-safe `createCloudTextures({ seed })` and share `shadowGLSL` with receiving materials. Each frame call `field.place(x, z, windDrift, lightDirection, cloudThreshold, shadowStrength)`, then `dome.update(deltaSeconds, lightDirection, cloudThreshold, elapsedSeconds, lightIntensity, region)`. Await `setDetail({ size, frames, steps, most, light, first, grow, fine })` and `dome.dispose()`. See the [browser fixture](test/atmosphere.js). |
| `rendering/daylight.js`, `rendering/height-haze.js` | `createSunMoonCycle()` writes orbital sun and moon directions into two reusable vectors, and `createHazeFollower()` follows terrain height between camera cuts. Call `installHeightHaze()` before compiling fog materials to add height haze and low mist, and `dispose()` to restore the original fog chunks. |
| `rendering/surface-projection.js` | `createProjectedMaterial(standardMaterialParameters, recipe)` builds a standard material with textures projected in metres. The recipe takes a distinct `cacheKey`, shared `uniforms`, optional `vertex` GLSL (`declarations`, `deformInstance`, `assign`), a `color` stage such as `triplanarColor({ texture, scale, gain, height })`, a `normal` stage such as `surfaceRelief({ height, strength, fadeStart, fadeEnd })` and an optional `finish(shader, renderer)`. Shaders receive `vL`, `vLN`, `vHalf`, `vSeed` and `vCW`; include `projectedVaryings` with custom fragment declarations. |
| `rendering/surface-light.js`, `rendering/interior-mapping.js`, `rendering/crust.js` | `wetSurface({ dampness, darkening, roughness, sheen })` wets the emissive-map stage, and `thinSurfaceLight({ sky, sun, glow, sunlight, where })` backlights thin surfaces from the first hemisphere and directional lights. `mappedRoom({ dimensions, shade })` declares `roomBehind(fine)` for interior-mapped vertical panes. `crustGLSL` declares `crustCracks(position, warp)` for filtered seam, rim and crack masks. See the [render fixture](test/projected-surface.js). |
| `geometry/terrain-chunks.js` | `terrainChunks(parent, grid, materials, options)` refines a square height grid in independent mesh batches. Grid colours are sRGB bytes and heights are in world units. Options supply the camera, a `createBatch(material)` callback returning a `PieceBatch`-compatible batch and optional distance thresholds. Call the returned update each frame, or pass `true` to refresh every chunk. |
| `geometry/shore-grid.js`, `geometry/stream.js` | `createShoreGrid()` samples signed-distance grids for one or more closed outlines. `streamGeometry(points, width, surface, bed, banks, fadeAt)` builds a ribbon along a path with flow vectors, bank depths and a widening spring; the caller places the mesh and chooses its material. |
| `rendering/water-material.js`, `rendering/wakes.js`, `rendering/sea-shaders.js` | `createWaterMaterials({ depthRect, level, seaParameters, wakes })` creates lake and stream materials with shared time, cloud and wake uniforms. `createWakes()` returns `followWake(object, length, beam)`, which returns a removal function; update tracked hulls each frame after world matrices. The sea and beach shaders take harbour dimensions and a shore palette from the application. `rippledStream(material, { speed, rapidSpeed })` adds bank-softened, pixel-filtered ripples moving downstream in metres per second. |
| `rendering/planar-reflection.js` | `createPlanarReflection({ camera, renderer, scene, drawnSize, waterCells, cellSize })` creates a cropped mirror camera and render target for a horizontal plane. `waterCells` returns the lower X/Z corners of wet cells. Call `renderMirror(uniforms, level, strength, occluded, frame)` while rendering, `sizeMirror()` on resize and `dispose()` at teardown. |

For geometry generated off the main thread, call `builder.parts(true)` in the worker and `geometryOf(parts)` on the page. This path frees static CPU-side attributes after upload. Keep the seed or source data if your application needs to regenerate meshes after a context loss.

## Contributing and license

See the [contributor guide](CONTRIBUTING.md) for local checks and release instructions. Use [GitHub Issues](https://github.com/enestaylan/roamwright/issues) for bugs and feature requests, or [report a vulnerability privately](https://github.com/enestaylan/roamwright/security/advisories/new).

Roamwright is distributed under the [MIT license](LICENSE). Notices for adapted components are in [licenses](licenses).

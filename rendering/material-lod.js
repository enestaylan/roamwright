import * as THREE from 'three';

const SCATTER = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';
// A copy of a material that draws only a share of its pixels (share.value, from 0 to 1), scattered evenly: a house built in detail dissolves in over its far version instead of jumping into place, and out again
// when it is let go. One copy to a material and share (a land's own stone has its own); all share one program.
const fadings = new WeakMap();
export function fadingOf(base, share) {
  let variants = fadings.get(base);
  if (!variants) fadings.set(base, (variants = new Map()));
  let variant = variants.get(share);
  if (variant) return variant;
  variants.set(share, (variant = base.clone()));
  variant.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    shader.uniforms.uShare = share;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uShare;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (${SCATTER} > uShare) discard;`);
  };
  variant.customProgramCacheKey = () => base.customProgramCacheKey() + ':dissolving';
  return variant;
}
// A copy of a material that draws only what lies nearer the eye than `reach.value` metres or, with `beyond`, only what lies
// further: a thing's near version and its far one hand over pixel by pixel across a band `band` metres deep about that distance,
// each drawing the pixels of the screen-fixed scatter (SCATTER) the other leaves, a share that follows the pixel's distance. No
// pixel is drawn by both, none by neither, and no stretch of the thing changes all at once. One copy to a material, reach, side
// and band; the two sides share one program each.
const reaching = new WeakMap();
export function reachOf(base, reach, beyond = false, band = 1) {
  let variants = reaching.get(base);
  if (!variants) reaching.set(base, (variants = new Map()));
  const key = `${beyond}:${band}`;
  let sides = variants.get(reach);
  if (!sides) variants.set(reach, (sides = {}));
  if (sides[key]) return sides[key];
  const variant = (sides[key] = base.clone());
  variant.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    shader.uniforms.uReach = reach;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReach;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${handedOver(beyond, nearShare('length(vViewPosition)', band))}`,
      );
  };
  variant.customProgramCacheKey = () => base.customProgramCacheKey() + (beyond ? ':beyond-reach:' : ':within-reach:') + band;
  return variant;
}
// The same for the instances of an InstancedMesh, each handed over whole and in its own time, using its geometry's `aNear` (an instanced attribute, 0 to 1) is the near version's share of the instance's
// pixels, which its builder moves from the one end to the other over a moment once the viewer comes within or goes beyond its
// reach. An instance its version does not draw at all has its vertices put out of sight. handOverShadow gives the near or far
// version's shadow body, which casts wherever its version draws anything: while an instance is handed over both cast, and their
// shadows, of one shape in two levels of detail, lie over each other.
const handing = new WeakMap();
export function handOverOf(base, beyond = false) {
  let variants = handing.get(base);
  if (!variants) handing.set(base, (variants = {}));
  if (variants[beyond]) return variants[beyond];
  const variant = (variants[beyond] = base.clone());
  variant.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    handOverVertices(shader, beyond);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNearShare;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${handedOver(beyond, 'vNearShare')}`);
  };
  variant.customProgramCacheKey = () => base.customProgramCacheKey() + (beyond ? ':handed-far' : ':handed-near');
  return variant;
}
export function handOverShadow(beyond = false) {
  const variant = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  variant.onBeforeCompile = shader => handOverVertices(shader, beyond);
  variant.customProgramCacheKey = () => (beyond ? 'handed-far-depth' : 'handed-near-depth');
  return variant;
}
// The near version's share, 1 short of the band about uReach and 0 past it, at a distance (a GLSL expression) from the eye
const nearShare = (distance, band) => `1.0 - smoothstep(uReach - ${(band / 2).toFixed(2)}, uReach + ${(band / 2).toFixed(2)}, ${distance})`;
// The fragment's test: the near version keeps the scatter's pixels under its share, the far version the rest
const handedOver = (beyond, share) => `if (${SCATTER} ${beyond ? '<' : '>='} ${share}) discard;`;
// Hands an instance's share (aNear) to the fragments (vNearShare), and puts the vertices of an instance its version does not draw
// at all out of sight.
function handOverVertices(shader, beyond) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aNear;\nvarying float vNearShare;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>\nvNearShare = aNear;\nif (aNear ${beyond ? '>= 1.0' : '<= 0.0'}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`,
    );
}
// The same material for meshes of another kind (kind: 'plain', 'instanced', or 'tinted' for instances with a colour each), drawn as
// the base is, its shader patch and cache key read from the base whenever it compiles. The renderer keeps one program state to a
// material: a material shared by meshes of different kinds has its program's parameters worked out anew each time it passes from
// one kind to the other, a few times every frame.
const twins = new WeakMap();
export function twinMaterial(base, kind) {
  let variants = twins.get(base);
  if (!variants) twins.set(base, (variants = {}));
  if (!variants[kind]) {
    const variant = (variants[kind] = base.clone());
    variant.onBeforeCompile = (shader, renderer) => base.onBeforeCompile(shader, renderer);
    variant.customProgramCacheKey = () => base.customProgramCacheKey();
  }
  return variants[kind];
}
export function glowMesh(geometry, hex, intensity, parent) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) }));
  if (parent) parent.add(mesh);
  return mesh;
}

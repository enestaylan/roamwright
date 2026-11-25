import * as THREE from 'three';
import { lerp } from '../math/scalar.js';

// Texture-backed bone rows and pre-baked motion feed the same meshes in every render pass.
export function applyCrowdSkinning(shader, { poseUniform, walk = null, depth = false, paletteOffset = 0 }) {
  const distant = !!walk;
  shader.uniforms.uCrowdPose = poseUniform;
  if (distant) shader.uniforms.uCrowdWalk = { value: walk };
  const common = `/* glsl */
    uniform highp sampler2D uCrowdPose;
    attribute vec2 aCrowdRows;
    ${depth ? '' : 'attribute float aPalette;'}`;
  const animated = `/* glsl */
    attribute float aWeight;
    attribute vec2 aJoints;
    mat4x3 crowdBone(int bone) {
      int b = bone * 3, row = int(aCrowdRows.x);
      vec4 x = texelFetch(uCrowdPose, ivec2(b, row), 0);
      vec4 y = texelFetch(uCrowdPose, ivec2(b + 1, row), 0);
      vec4 z = texelFetch(uCrowdPose, ivec2(b + 2, row), 0);
      return mat4x3(vec3(x.x, y.x, z.x), vec3(x.y, y.y, z.y), vec3(x.z, y.z, z.z), vec3(x.w, y.w, z.w));
    }
    mat4x3 crowdTransform() {
      mat4x3 a = crowdBone(int(aJoints.x));
      if (aWeight > 0.999) return a;
      return a * aWeight + crowdBone(int(aJoints.y)) * (1.0 - aWeight);
    }`;
  const baked = `/* glsl */
    uniform highp sampler2D uCrowdWalk;
    vec4 crowdVertex() { return texelFetch(uCrowdWalk, ivec2(gl_VertexID, int(aCrowdRows.x)), 0); }
    vec3 crowdNormal(float data) {
      vec2 u = vec2(floor(data * (1.0 / 4096.0)), mod(data, 4096.0)) * (2.0 / 4095.0) - 1.0;
      vec3 n = vec3(u, 1.0 - abs(u.x) - abs(u.y));
      if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * (step(0.0, n.xy) * 2.0 - 1.0);
      return normalize(n);
    }`;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + common + (distant ? baked : animated));
  if (depth) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      distant ? 'vec3 transformed = crowdVertex().xyz;' : 'vec3 transformed = crowdTransform() * vec4(position, 1.0);',
    );
  } else {
    const normals = distant
      ? 'vec4 crowdPose = crowdVertex(); objectNormal = crowdNormal(crowdPose.w);'
      : 'mat4x3 crowdPose = crowdTransform(); objectNormal = crowdPose * vec4(objectNormal, 0.0);';
    const position = distant ? 'crowdPose.xyz' : 'crowdPose * vec4(position, 1.0)';
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <color_vertex>',
        `/* glsl */
#include <color_vertex>
        if (aPalette > 0.5) vColor.rgb *= texelFetch(uCrowdPose, ivec2(${paletteOffset} + int(aPalette) - 1, int(aCrowdRows.y)), 0).rgb;`,
      )
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + normals)
      .replace('#include <begin_vertex>', `/* glsl */ vec3 transformed = ${position};`);
  }
}

export function createCrowdBatch(scene, geo, max, mat, [depth, distance], name, casts = true) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  const rows = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aCrowdRows', rows);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = casts;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  scene.add(mesh);
  return { mesh, rows, count: 0, shadow: null };
}

export function castCrowdShadow(scene, near, geo, [depth, distance]) {
  const mesh = new THREE.InstancedMesh(geo, near.mesh.material, 0);
  let held = 0;
  geo.setAttribute('aCrowdRows', near.rows);
  mesh.instanceMatrix = near.mesh.instanceMatrix;
  mesh.name = near.mesh.name + ' shadow';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  mesh.onBeforeRender = () => {
    held = mesh.count; // a colour pass draws none of them (the card is given no instances), the shadow pass all
    mesh.count = 0;
  };
  mesh.onAfterRender = () => (mesh.count = held);
  near.mesh.castShadow = false;
  near.shadow = mesh;
  scene.add(mesh);
}

// One frame of a faraway figure's walk: each vertex bent by the walker's bones as posed now (row 0 of the pose texture), with its
// normal packed, appended to the walk's texels.
export function bakeCrowdFrame(walk, bones) {
  const { position, normal, aJoints, aWeight } = walk.geo.attributes,
    vertices = walk.vertices;
  let k = walk.k;
  for (let i = 0; i < position.count; i++) {
    const a = aJoints.getX(i) * 12,
      b = aJoints.getY(i) * 12,
      w = aWeight.getX(i);
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const nx = normal.getX(i),
      ny = normal.getY(i),
      nz = normal.getZ(i);
    const m = j => lerp(bones[b + j], bones[a + j], w);
    const after = (v, u, q, j) => m(j) * v + m(j + 1) * u + m(j + 2) * q;
    vertices[k++] = after(x, y, z, 0) + m(3);
    vertices[k++] = after(x, y, z, 4) + m(7);
    vertices[k++] = after(x, y, z, 8) + m(11);
    let vx = after(nx, ny, nz, 0),
      vy = after(nx, ny, nz, 4);
    const vz = after(nx, ny, nz, 8),
      scale = Math.abs(vx) + Math.abs(vy) + Math.abs(vz) || 1;
    vx /= scale;
    vy /= scale;
    if (vz < 0) {
      const u = (1 - Math.abs(vy)) * (vx < 0 ? -1 : 1);
      vy = (1 - Math.abs(vx)) * (vy < 0 ? -1 : 1);
      vx = u;
    }
    // Octahedral normals use two twelve-bit values in a float's exact integer range.
    vertices[k++] = Math.round((vx * 0.5 + 0.5) * 4095) * 4096 + Math.round((vy * 0.5 + 0.5) * 4095);
  }
  walk.k = k;
}


import { MeshStandardMaterial } from 'three';

export const projectedVaryings = 'varying vec3 vL; varying vec3 vLN; varying vec3 vHalf; varying float vSeed; varying vec2 vCW;';

// Project unit-instance geometry in local metres and track world XZ after deformation.
function projectSurfaceVertex(shader, { declarations = '', deformInstance = '', assign = '' } = {}) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + projectedVaryings + declarations).replace(
    '#include <begin_vertex>',
    `/* glsl */
#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vL = position * iS; vHalf = iS * 0.5;
          vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.291) * 8.0;
          ${deformInstance}
        #else
          vL = position; vHalf = vec3(1000.0); vSeed = 0.0;
        #endif
        vLN = normal;${assign}`,
  );
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    '#include <project_vertex>\n{ vec4 cw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ncw = instanceMatrix * cw;\n#endif\nvCW = (modelMatrix * cw).xz; }',
  );
}

// Multiplies the standard material colour and sets the height used for relief.
export const triplanarColor = ({ texture, scale, gain, height }) => `/* glsl */
      vec3 bw = abs(vLN); bw *= bw; bw /= (bw.x + bw.y + bw.z);
      vec3 tx = texture2D(${texture}, vL.zy * ${scale}).rgb * bw.x + texture2D(${texture}, vL.xz * ${scale}).rgb * bw.y + texture2D(${texture}, vL.xy * ${scale}).rgb * bw.z;
      ${height} = dot(tx, vec3(0.333));
      diffuseColor.rgb *= tx * ${gain};`;

export const surfaceRelief = ({ height, strength, fadeStart, fadeEnd }) => `/* glsl */
        { // relief from the procedural height ${height}, fading with distance
          float bs = ${strength} * (1.0 - smoothstep(${fadeStart}, ${fadeEnd}, length(vViewPosition)));
          if (bs > 0.01) {
            vec3 sgx = dFdx(-vViewPosition), sgy = dFdy(-vViewPosition); float lx = length(sgx), ly = length(sgy);
            if (lx > 1e-7 && ly > 1e-7) {
              sgx /= lx; sgy /= ly;
              vec3 r1 = cross(sgy, normal), r2 = cross(normal, sgx); float det = dot(sgx, r1);
              vec3 nb = abs(det) * normal - bs * sign(det) * (dFdx(${height}) * r1 + dFdy(${height}) * r2); float l2 = dot(nb, nb);
              if (l2 > 1e-8) normal = nb * inversesqrt(l2);          // never normalise a zero vector: one bad pixel becomes a black block after bloom
            }
          }
        }`;

// A standard material with metre-scale projection. Uniform wrappers are shared across compilations.
export function createProjectedMaterial(
  parameters,
  { cacheKey, uniforms, vertex, declarations = projectedVaryings, color, normal, finish },
) {
  if (typeof cacheKey !== 'string' || !cacheKey) throw new TypeError('A projected material needs a shader variant key');
  const material = new MeshStandardMaterial(parameters);
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms);
    projectSurfaceVertex(shader, vertex);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + declarations);
    if (color) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', color);
    if (normal)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n' + normal,
      );
    finish?.(shader, renderer);
  };
  return material;
}

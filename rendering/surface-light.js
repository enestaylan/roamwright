export const wetSurface = ({ dampness, darkening, roughness, sheen }) => `/* glsl */
if (${dampness} > 0.0) { float up = clamp(dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0, 1.0); diffuseColor.rgb *= 1.0 - ${dampness} * ${darkening}; roughnessFactor = mix(roughnessFactor, ${roughness}, ${dampness} * up * ${sheen}); }`;

// Backlighting from the first hemisphere and directional light, with optional forward scattering.
export const thinSurfaceLight = ({ sky, sun, glow = 0, where = '1.0', sunlight = '1.0' }) => `/* glsl */
      vec3 through = vec3(0.0);
      #if NUM_HEMI_LIGHTS > 0
        through += hemisphereLights[0].skyColor * max(-dot(normal, hemisphereLights[0].direction), 0.0) * ${sky.toFixed(2)};
      #endif
      #if NUM_DIR_LIGHTS > 0
        through += directionalLights[0].color * max(-dot(normal, directionalLights[0].direction), 0.0) * ${sun.toFixed(2)};
      #endif
      outgoingLight += diffuseColor.rgb * through;${glow ? sunGlow(glow, where, sunlight) : ''}
      #include <opaque_fragment>`;
const sunGlow = (glow, where, sunlight) => `
      #if NUM_DIR_LIGHTS > 0
      {
        vec3 toEye = normalize(vViewPosition), hue = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), 0.04);
        float against = max(-dot(toEye, directionalLights[0].direction), 0.0), edge = 1.0 - abs(dot(normal, toEye));
        outgoingLight += hue * directionalLights[0].color * (0.3 * pow(against, 4.0) + pow(against, 20.0)) * edge * edge * edge * ${sunlight} * ${glow.toFixed(2)} * (${where});
      }
      #endif`;

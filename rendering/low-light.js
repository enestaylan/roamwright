// Shader functions for diffuse reflectance under dim illumination. Both take linear RGB.
// Vary adaptation with illumination so a surface close to a bright source keeps its color.
export const LOW_LIGHT_REFLECTANCE = /* glsl */ `
  vec3 lowLightReflectance(vec3 albedo, float adaptation) {
    float neutral = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    return mix(albedo, vec3(neutral), clamp(adaptation, 0.0, 1.0));
  }
  vec3 diffuseTextileBounce(vec3 albedo, vec3 irradiance, float fiberScatter) {
    // Neutral scattering at the yarn surface remains visible even when the dye absorbs a narrow-band light.
    float fiber = sqrt(max(dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 0.0));
    return irradiance * mix(albedo, vec3(fiber), clamp(fiberScatter, 0.0, 1.0));
  }
`;

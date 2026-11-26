// World-space rock for a heightfield. The horizontal components of the surface normal
// weight fixed vertical projections; changing the normal never changes the coordinates.
export const terrainRockGLSL = /* glsl */ `
vec3 rockFaceSample(sampler2D grain, vec3 texturePosition, float xWeight) {
  return mix(texture2D(grain, texturePosition.xy).rgb, texture2D(grain, texturePosition.zy + vec2(0.37, 0.19)).rgb, xWeight);
}
float rockBed(float height, float frequency, float phase, float footprint) {
  return 0.5 + 0.5 * sin(height * frequency + phase) *
    (1.0 - smoothstep(0.2, 0.5, footprint * frequency));
}
vec4 terrainRock(sampler2D grain, vec3 worldPosition, vec3 normal, vec3 darkBed, vec3 lightBed, vec3 iron, vec3 lime) {
  vec2 weights = normal.xz * normal.xz;
  weights *= weights;
  float across = weights.x / max(weights.x + weights.y, 0.00001);
  vec3 broad = rockFaceSample(grain, worldPosition * 0.021, across);
  vec3 broken = rockFaceSample(grain, worldPosition * 0.13, across);
  vec3 fine = rockFaceSample(grain, worldPosition * 0.68, across);
  // Warped beds follow the height through corners. Individual grains keep roughly the same size in both axes.
  float height = worldPosition.y + (texture2D(grain, worldPosition.xz * 0.0031).r - 0.5) * 22.0
    + (broad.g - 0.5) * 3.5 + (broken.b - 0.5) * 1.5;
  float footprint = fwidth(height) * 0.15915;
  float major = rockBed(height, 0.83, 0.0, footprint), minor = rockBed(height, 2.57, 1.3, footprint);
  float stained = rockBed(height, 0.29, 0.7, footprint), lamina = rockBed(height, 7.3, 0.0, footprint);
  vec3 colour = mix(darkBed, lightBed, major * 0.6 + minor * 0.4);
  colour = mix(colour, iron, smoothstep(0.62, 0.95, stained) * 0.55);
  colour = mix(colour, lime, smoothstep(0.75, 1.0, minor * major) * 0.5);
  colour *= (0.92 + 0.12 * lamina) * (0.85 + 0.3 * fine.r) * (0.78 + 0.44 * broad.b) * (0.72 + 0.56 * broken.g);
  return vec4(colour, minor * 0.4 + lamina * 0.12 + broken.g * 0.75 + fine.r * 0.3);
}`;

// Fragment normal for a scalar height. Derivatives are evaluated across the entire quad before the grazing-angle test.
export const terrainReliefGLSL = /* glsl */ `
vec3 terrainReliefNormal(vec3 viewToEye, vec3 normal, float height, float strength, vec2 fadeMetres) {
  vec3 sx = dFdx(-viewToEye), sy = dFdy(-viewToEye);
  float gx = dFdx(height), gy = dFdy(height);
  float bump = strength * (1.0 - smoothstep(fadeMetres.x, fadeMetres.y, length(viewToEye))) *
    smoothstep(0.06, 0.4, abs(dot(normal, normalize(viewToEye))));
  float lx = length(sx), ly = length(sy);
  if (bump > 0.01 && lx > 1e-7 && ly > 1e-7) {
    sx /= lx; sy /= ly;
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 tilted = abs(det) * normal - bump * sign(det) * (gx * r1 + gy * r2);
    float squared = dot(tilted, tilted);
    if (squared > 1e-8) return tilted * inversesqrt(squared);
  }
  return normal;
}`;

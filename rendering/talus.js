// Fragment shading for angular debris on a heightfield apron. Use a world position in
// metres and its derivatives, and the mean spacing of the stones. X is signed facet brightness, Y relief.
export const talusGLSL = /* glsl */ `
vec2 talusFragment(vec2 metres, vec2 dx, vec2 dy, float spacing, float seed) {
  mat2 basis = mat2(0.868, -0.497, 0.497, 0.868) / spacing;
  vec2 q = basis * metres;
  vec2 footprint = abs(basis * dx) + abs(basis * dy);
  float resolved = 1.0 - smoothstep(0.12, 0.45, max(footprint.x, footprint.y));
  q.x += 0.5 * mod(floor(q.y), 2.0);
  vec2 cell = floor(q), p = fract(q) - 0.5;
  vec3 h = fract(vec3(cell.xyx) * vec3(0.1031, 0.11369, 0.13787) + seed);
  h += dot(h, h.yzx + 19.19);
  h = fract((h.xxy + h.yzz) * h.zyx);
  p -= (h.xy - 0.5) * 0.14;
  float angle = h.z * 6.28318;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  float halfWidth = mix(0.13, 0.32, h.y);
  vec2 shape = p / vec2(halfWidth, halfWidth * mix(0.5, 0.9, h.x));
  // Two chipped corners and a slanted top distinguish a fragment from a round pebble.
  float edge = max(max(abs(shape.x), abs(shape.y)), max(dot(shape, vec2(0.77, 0.88)), dot(shape, vec2(-0.74, -0.80))));
  float aa = min(0.8, max(0.025, max(footprint.x, footprint.y) / halfWidth));
  float inside = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, edge)) * resolved;
  float crest = max(0.0, 1.0 - edge);
  float facet = mix(-0.32, 0.36, smoothstep(-aa, aa, shape.x * 0.8 + shape.y * 0.2 + h.z - 0.5));
  return inside * vec2(facet + (h.x - 0.5) * 0.34, 0.28 + 0.72 * crest);
}`;

// Fragment shading for angular debris on a heightfield apron. Use a world position in
// metres and its derivatives, and the mean spacing of the stones. X is signed facet brightness, Y relief.
export const talusGLSL = /* glsl */ `
vec2 talusFragment(vec2 metres, vec2 dx, vec2 dy, float spacing, float seed) {
  mat2 basis = mat2(0.868, -0.497, 0.497, 0.868) / spacing;
  vec2 gridPosition = basis * metres;
  vec2 footprint = abs(basis * dx) + abs(basis * dy);
  float resolved = 1.0 - smoothstep(0.12, 0.45, max(footprint.x, footprint.y));
  gridPosition.x += 0.5 * mod(floor(gridPosition.y), 2.0);
  vec2 cell = floor(gridPosition), cellPosition = fract(gridPosition) - 0.5;
  vec3 cellHash = fract(vec3(cell.xyx) * vec3(0.1031, 0.11369, 0.13787) + seed);
  cellHash += dot(cellHash, cellHash.yzx + 19.19);
  cellHash = fract((cellHash.xxy + cellHash.yzz) * cellHash.zyx);
  cellPosition -= (cellHash.xy - 0.5) * 0.14;
  float angle = cellHash.z * 6.28318;
  cellPosition = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * cellPosition;
  float halfWidth = mix(0.13, 0.32, cellHash.y);
  vec2 shape = cellPosition / vec2(halfWidth, halfWidth * mix(0.5, 0.9, cellHash.x));
  // Two chipped corners and a slanted top distinguish a fragment from a round pebble.
  float edge = max(max(abs(shape.x), abs(shape.y)), max(dot(shape, vec2(0.77, 0.88)), dot(shape, vec2(-0.74, -0.80))));
  float filterWidth = min(0.8, max(0.025, max(footprint.x, footprint.y) / halfWidth));
  float inside = (1.0 - smoothstep(1.0 - filterWidth, 1.0 + filterWidth, edge)) * resolved;
  float crest = max(0.0, 1.0 - edge);
  float facet = mix(-0.32, 0.36, smoothstep(-filterWidth, filterWidth, shape.x * 0.8 + shape.y * 0.2 + cellHash.z - 0.5));
  return inside * vec2(facet + (cellHash.x - 0.5) * 0.34, 0.28 + 0.72 * crest);
}`;

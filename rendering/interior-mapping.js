// Intersect the view ray with a repeated box behind a vertical facade, in local room coordinates.
export const mappedRoom = ({ dimensions, shade }) => /* glsl */ `
const vec3 ROOM = vec3(${dimensions});
vec3 roomBehind(float fine) {
  vec3 wp = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz,
    n = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  if (abs(n.y) > 0.5) return vec3(1.0);
  n = normalize(vec3(n.x, 0.0, n.z));
  vec3 t = vec3(-n.z, 0.0, n.x), ray = normalize(wp - cameraPosition);
  vec2 p = vec2(dot(wp, t), wp.y) / ROOM.xy;
  vec3 d = vec3(dot(ray, t), ray.y, -dot(ray, n)) / ROOM;
  if (d.z <= 0.0) return vec3(1.0);
  vec2 cell = floor(p);
  vec3 o = vec3(fract(p), 0.0);
  vec3 tt = (step(0.0, d) - o) / d; // to the far plane on each axis
  float tm = min(min(tt.x, tt.y), tt.z);
  vec3 h = o + d * tm;
${shade}
}`;
